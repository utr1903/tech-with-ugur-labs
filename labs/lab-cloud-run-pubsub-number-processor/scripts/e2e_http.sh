#!/usr/bin/env bash
# Curl responses go to a temporary file; never print bearer tokens.
request() {
  local token=$1 method=$2 url=$3
  shift 3
  local headers=()
  if [[ -n "$token" ]]; then headers=(-H "Authorization: Bearer $token"); fi
  HTTP_CODE=$(curl --silent --show-error --max-time 30 -o "$TMP/body" -w '%{http_code}' \
    -X "$method" "${headers[@]}" "$@" "$url")
}
expect_status() {
  [[ "$HTTP_CODE" == "$1" ]] || die "Expected HTTP $1, got $HTTP_CODE; response: $(cat "$TMP/body")"
}
denied() {
  local token=$1 method=$2 url=$3 permission=$4
  shift 4
  request "$token" "$method" "$url" "$@"
  expect_status 403
  jq -e --arg permission "$permission" '.error.code == 403 and ((.error.message | contains($permission)) or ($permission == "pubsub.topics.publish" and .error.status == "PERMISSION_DENIED"))' "$TMP/body" >/dev/null \
    || die "403 did not identify expected permission $permission; response: $(cat "$TMP/body")"
  echo "PASS: $permission denied ($method)" >&2
}
read_logs() {
  local message_id=$1
  gcloud logging read \
    "resource.type=cloud_run_revision AND resource.labels.service_name=\"$LAB_NAME-processor\" AND jsonPayload.event=\"processed\" AND jsonPayload.message_id=\"$message_id\"" \
    --project="$PROJECT_ID" --freshness=1h --limit=100 --format=json
}
wait_processed() {
  local message_id=$1 outcome=$2 deadline=$((SECONDS + E2E_TIMEOUT)) logs match
  while (( SECONDS < deadline )); do
    logs=$(read_logs "$message_id") || die "Unable to read completion logs for $message_id"
    match=$(jq -c --arg id "$message_id" --arg outcome "$outcome" \
      '[.[] | .jsonPayload | select(.event=="processed" and .message_id==$id and .outcome==$outcome)][0] // empty' <<< "$logs")
    if [[ -n "$match" ]]; then printf '%s\n' "$match"; return; fi
    sleep "$E2E_INTERVAL"
  done
  die "Timed out after ${E2E_TIMEOUT}s waiting for $message_id outcome=$outcome (delivery, IAM, and log ingestion may be delayed)"
}
observe_skipped() {
  local message_id=$1 event deadline=$((SECONDS + E2E_OBSERVE)) logs
  event=$(wait_processed "$message_id" skipped)
  jq -e 'has("object_name") | not' <<< "$event" >/dev/null || die 'Skipped event unexpectedly contains object_name'
  deadline=$((SECONDS + E2E_OBSERVE))
  while (( SECONDS < deadline )); do
    logs=$(read_logs "$message_id")
    jq -e --arg id "$message_id" '[.[] | .jsonPayload | select(.message_id==$id and (.outcome=="stored" or has("object_name")))] | length==0' <<< "$logs" >/dev/null \
      || die "Unexpected stored event for skipped message $message_id"
    sleep "$E2E_INTERVAL"
  done
  echo "PASS: $message_id skipped; no stored completion observed for ${E2E_OBSERVE}s"
}
