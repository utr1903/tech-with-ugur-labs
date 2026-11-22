# shellcheck shell=bash
# Aikido REST API client. Source it; don't execute it.
# Secrets (client secret, access token, agent token) never reach argv, logs or disk.

# shellcheck source-path=SCRIPTDIR source=common.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

AIKIDO_API_BASE="${AIKIDO_API_BASE:-https://app.aikido.dev/api/public/v1}"
AIKIDO_TOKEN_URL="${AIKIDO_TOKEN_URL:-https://app.aikido.dev/api/oauth/token}"
AIKIDO_RETRY_DELAY="${AIKIDO_RETRY_DELAY:-5}"
AIKIDO_CONNECT_TIMEOUT="${AIKIDO_CONNECT_TIMEOUT:-120}"
AIKIDO_CONNECT_INTERVAL="${AIKIDO_CONNECT_INTERVAL:-15}"
AIKIDO_DEMO_PREFIX="aikido-demo-"
# An Aikido outage must not hang deploy/destroy (destroy still has to tear down AWS).
AIKIDO_CURL_TIMEOUTS=(--connect-timeout 10 --max-time 60)

_AIKIDO_TOKEN=""
_AIKIDO_TOKEN_EXP=0

_now() { date +%s; }

# --- Token ---------------------------------------------------------------------
# Fetches a token into _AIKIDO_TOKEN unless the cached one is valid for 60 more seconds.
_aikido_ensure_token() {
  if [[ -n "$_AIKIDO_TOKEN" && "$(_now)" -lt $((_AIKIDO_TOKEN_EXP - 60)) ]]; then
    return 0
  fi
  local resp code body
  resp="$(printf 'user = "%s:%s"\n' "$AIKIDO_CLIENT_ID" "$AIKIDO_CLIENT_SECRET" |
    curl -sS "${AIKIDO_CURL_TIMEOUTS[@]}" --config - -X POST -H 'Content-Type: application/json' \
      -d '{"grant_type":"client_credentials"}' -w '\n%{http_code}' "$AIKIDO_TOKEN_URL")" || true
  code="${resp##*$'\n'}"
  body="${resp%$'\n'*}"
  if [[ "$code" != 2* ]] || ! jq -e '.access_token' > /dev/null 2>&1 <<< "$body"; then
    log_warn "Aikido token request failed (HTTP $code); check AIKIDO_CLIENT_ID / AIKIDO_CLIENT_SECRET"
    return 1
  fi
  _AIKIDO_TOKEN="$(jq -r '.access_token' <<< "$body")"
  _AIKIDO_TOKEN_EXP=$(($(_now) + $(jq -r '.expires_in // 3600' <<< "$body")))
}

# Prints a bearer token. Call it once in the parent shell (not in $(...)) to warm the cache.
aikido_token() {
  _aikido_ensure_token || return 1
  printf '%s\n' "$_AIKIDO_TOKEN"
}

# --- Raw request ---------------------------------------------------------------
# _aikido_request METHOD PATH [JSON]: prints "<body>\n<status>". Retries 429/5xx and transport errors.
_aikido_request() {
  local method="$1" path="$2" data="${3-}" resp code attempt rc=0 bodyfile=""
  local args=(-sS "${AIKIDO_CURL_TIMEOUTS[@]}" -X "$method" -H @- -w '\n%{http_code}')
  _aikido_ensure_token || return 1
  if [[ -n "$data" ]]; then
    # The body goes through a private temp file: secrets in it never reach argv.
    bodyfile="$(umask 077 && mktemp)" || return 1
    printf '%s' "$data" > "$bodyfile"
    args+=(--data-binary "@$bodyfile")
  fi
  for attempt in 1 2 3; do
    resp="$(printf 'Authorization: Bearer %s\nContent-Type: application/json\nAccept: application/json\n' "$_AIKIDO_TOKEN" |
      curl "${args[@]}" "$AIKIDO_API_BASE$path")" || resp=$'\n000'
    code="${resp##*$'\n'}"
    case "$code" in
      429 | 5* | 000) [[ $attempt -lt 3 ]] && sleep "$AIKIDO_RETRY_DELAY" ;;
      *) break ;;
    esac
  done
  [[ -n "$bodyfile" ]] && { rm -f "$bodyfile" || rc=1; }
  printf '%s' "$resp"
  return "$rc"
}

# _aikido_ok STATUS BODY: 2xx with a JSON (or empty) body.
_aikido_ok() {
  [[ "$1" == 2* ]] || return 1
  [[ -z "$2" ]] || jq -e . > /dev/null 2>&1 <<< "$2"
}

# aikido_api METHOD PATH [JSON]: prints the response body; fails on non-2xx or a non-JSON body.
aikido_api() {
  local resp code body
  resp="$(_aikido_request "$@")" || return 1
  code="${resp##*$'\n'}"
  body="${resp%$'\n'*}"
  if ! _aikido_ok "$code" "$body"; then
    log_warn "aikido_api $1 $2 -> $code: ${body:0:300}"
    return 1
  fi
  printf '%s\n' "$body"
}

# _aikido_paged PATH: prints every item of a paginated list endpoint as one JSON object per line.
_aikido_paged() {
  local page=0 body count
  while [[ $page -lt 100 ]]; do
    body="$(aikido_api GET "$1?page=$page&per_page=100")" || return 1
    jq -c '.[]' <<< "$body"
    count="$(jq 'length' <<< "$body")"
    [[ "$count" -lt 100 ]] && return 0
    page=$((page + 1))
  done
}

# --- Workspace / clouds ---------------------------------------------------------
aikido_workspace_id() {
  aikido_api GET /workspace | jq -r '.id'
}

aikido_find_cloud_by_name() {
  local items
  items="$(_aikido_paged /clouds)" || return 1
  [[ -z "$items" ]] && return 0
  jq -r --arg n "$1" 'select(.name == $n) | .id' <<< "$items" | head -n 1
}

# aikido_connect_aws ROLE_ARN NAME: prints the new cloud id. Retries 4xx (IAM propagation) until the timeout.
aikido_connect_aws() {
  local data resp code body deadline
  data="$(jq -cn --arg r "$1" --arg n "$2" '{role_arn: $r, name: $n, environment: "production"}')"
  _aikido_ensure_token || return 1
  deadline=$(($(_now) + AIKIDO_CONNECT_TIMEOUT))
  while true; do
    resp="$(_aikido_request POST /clouds/aws "$data")" || return 1
    code="${resp##*$'\n'}"
    body="${resp%$'\n'*}"
    if _aikido_ok "$code" "$body"; then
      jq -r '.id' <<< "$body"
      return 0
    fi
    if [[ "$code" == 4* && "$(_now)" -lt "$deadline" ]]; then
      log_info "AWS connect returned $code (IAM propagation?), retrying in ${AIKIDO_CONNECT_INTERVAL}s: ${body:0:200}"
      sleep "$AIKIDO_CONNECT_INTERVAL"
      continue
    fi
    log_warn "aikido_api POST /clouds/aws -> $code: ${body:0:300}"
    return 1
  done
}

# _aikido_post_retry PATH JSON LABEL JQ_FILTER: POSTs, retrying 4xx (new keys take a while to become valid)
# until AIKIDO_CONNECT_TIMEOUT, and prints the value JQ_FILTER selects from the response.
_aikido_post_retry() {
  local path="$1" data="$2" label="$3" filter="$4" resp code body deadline
  _aikido_ensure_token || return 1
  deadline=$(($(_now) + AIKIDO_CONNECT_TIMEOUT))
  while true; do
    resp="$(_aikido_request POST "$path" "$data")" || return 1
    code="${resp##*$'\n'}"
    body="${resp%$'\n'*}"
    if _aikido_ok "$code" "$body"; then
      jq -r "$filter" <<< "$body"
      return 0
    fi
    if [[ "$code" == 4* && "$(_now)" -lt "$deadline" ]]; then
      log_info "$label returned $code (key propagation?), retrying in ${AIKIDO_CONNECT_INTERVAL}s"
      sleep "$AIKIDO_CONNECT_INTERVAL"
      continue
    fi
    log_warn "aikido_api POST $path -> $code"
    return 1
  done
}

# aikido_connect_gcp NAME PROJECT_ID KEY_FILE ENVIRONMENT: prints the new cloud id.
aikido_connect_gcp() {
  local data
  data="$(jq -cn --arg n "$1" --arg p "$2" --rawfile k "$3" --arg e "$4" \
    '{name: $n, project_id: $p, access_key: $k, environment: $e}')" || return 1
  _aikido_post_retry /clouds/gcp "$data" "GCP connect" '.id'
}

# aikido_add_gcp_registry PROJECT_ID KEY_FILE: prints the registry id.
# There is no list/delete endpoint for registries, so callers keep the id in state.
aikido_add_gcp_registry() {
  local data
  data="$(jq -cn --arg p "$1" --rawfile k "$2" '{project_id: $p, service_account_key: $k}')" || return 1
  _aikido_post_retry /containers/registries/gcp-artifact-registry "$data" "GCP registry add" '.registry_id'
}

# aikido_registry_exists ID: exit 0 iff the registry is known to Aikido.
aikido_registry_exists() {
  local resp code body
  [[ -n "${1-}" ]] || return 1
  resp="$(_aikido_request GET "/containers/registries/$1")" || return 1
  code="${resp##*$'\n'}"
  body="${resp%$'\n'*}"
  _aikido_ok "$code" "$body" && [[ -n "$body" ]]
}

# aikido_containers_in_registry REGISTRY_ID: prints one container id per line.
aikido_containers_in_registry() {
  local items
  items="$(_aikido_paged /containers)" || return 1
  [[ -z "$items" ]] && return 0
  jq -r --argjson r "$1" 'select(.registry_id == $r) | .id' <<< "$items"
}

# aikido_mark_container ID: activates, marks internet-exposed + extreme sensitivity, scans.
# Attempts every call; returns non-zero if any failed.
aikido_mark_container() {
  local id="$1" rc=0
  aikido_api POST /containers/activate "$(jq -cn --argjson i "$id" '{container_repo_id: $i}')" > /dev/null || rc=1
  aikido_api PUT "/containers/$id/internetConnection" '{"internet_exposed":"connected"}' > /dev/null || rc=1
  aikido_api PUT "/containers/$id/sensitivity" '{"sensitivity":"extreme"}' > /dev/null || rc=1
  aikido_api POST "/containers/$id/scan" > /dev/null || rc=1
  return "$rc"
}

# aikido_create_k8s NAME: prints the raw JSON {id, endpoint, agent_token, ...}. Capture it in a variable only.
aikido_create_k8s() {
  local data
  data="$(jq -cn --arg n "$1" '{name: $n, environment: "production", enable_image_scanning: true,
    excluded_namespaces: ["kube-system", "kube-public", "kube-node-lease"]}')"
  local body
  body="$(aikido_api POST /clouds/kubernetes "$data")" || return 1
  if ! jq -e '(.id | type == "number") and (.agent_token | type == "string" and length > 0)' > /dev/null <<< "$body"; then
    log_warn "Aikido K8s cloud response lacks id or agent_token (fields: $(jq -c 'keys' <<< "$body" 2> /dev/null))"
    return 1
  fi
  printf '%s\n' "$body"
}

# aikido_delete_cloud ID: deletes a demo cloud. Unknown id or 404 = already gone.
# Refuses any cloud whose name doesn't start with "aikido-demo-".
aikido_delete_cloud() {
  local id="$1" items name resp code body
  items="$(_aikido_paged /clouds)" || return 1
  name="$( [[ -z "$items" ]] || jq -r --argjson id "$id" 'select(.id == $id) | .name' <<< "$items" | head -n 1)"
  if [[ -z "$name" ]]; then
    log_info "Aikido cloud $id not found (already gone)"
    return 0
  fi
  if [[ "$name" != "$AIKIDO_DEMO_PREFIX"* ]]; then
    log_warn "refusing to delete Aikido cloud $id ('$name'): not an $AIKIDO_DEMO_PREFIX* cloud"
    return 1
  fi
  resp="$(_aikido_request DELETE "/clouds/$id")" || return 1
  code="${resp##*$'\n'}"
  body="${resp%$'\n'*}"
  if [[ "$code" == 404 ]] || _aikido_ok "$code" "$body"; then
    log_info "deleted Aikido cloud $id ($name)"
    return 0
  fi
  log_warn "aikido_api DELETE /clouds/$id -> $code: ${body:0:300}"
  return 1
}

# --- Code repositories --------------------------------------------------------
aikido_find_code_repo() {
  local items
  items="$(_aikido_paged /repositories/code)" || return 1
  [[ -z "$items" ]] && return 0
  jq -r --arg n "$1" 'select(.name == $n) | .id' <<< "$items" | head -n 1
}

aikido_scan_repo() {
  aikido_api POST "/repositories/code/$1/scan" \
    '{"include_sast_scan":true,"include_iac_scan":true,"include_secrets_scan":true}' > /dev/null
}

# aikido_export_issues: prints the JSON array of all open issues (one entry per issue, not per group).
aikido_export_issues() {
  aikido_api GET "/issues/export?filter_status=open"
}

# --- Deploy decisions -----------------------------------------------------------
# decide_k8s_cloud CLOUD_ID RELEASE_INSTALLED(yes|no): the agent token is only returned on create,
# so an existing cloud is only reusable while its agent release is still installed.
decide_k8s_cloud() {
  if [[ -z "$1" ]]; then
    echo create
  elif [[ "$2" == "yes" ]]; then
    echo reuse
  else
    echo replace
  fi
}
