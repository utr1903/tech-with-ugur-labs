#!/usr/bin/env bash
# A deliberately conservative assessment: unresolved inheritance stops the check.
check_ancestor_policy() {
  local file=$1
  # Called only after a successful policy read for a confirmed ancestor.
  # Google may omit bindings entirely when that resource has no direct grants.
  jq -e 'type == "object" and (if has("bindings") then
    (.bindings | type == "array" and all(.[];
      type == "object" and (.role|type == "string") and
      (.members|type == "array" and all(.[]; type == "string"))))
    else true end)' "$file" >/dev/null || die 'Malformed ancestor policy evidence'
  local unexpected
  unexpected=$(jq -c --arg prefix "$LAB_NAME-" --arg suffix "@$PROJECT_ID.iam.gserviceaccount.com" '
    [.bindings[]? | select(any(.members[]?;
      . == "allUsers" or . == "allAuthenticatedUsers" or
      startswith("group:") or startswith("domain:") or startswith("principal") or
      (startswith("serviceAccount:" + $prefix) and endswith($suffix))))]' "$file")
  [[ "$unexpected" == '[]' ]] || die "Unresolved or broad inherited grants: $unexpected. Review/remove these in a dedicated project; the verifier cannot resolve groups, domains, conditions or principal sets."
}
inspect_policies() {
  local ancestors type id policy
  ancestors=$(gcloud projects get-ancestors "$PROJECT_ID" --format=json) || die 'Cannot retrieve full resource ancestry'
  jq -e --arg project "$PROJECT_ID" 'type=="array" and length>0 and any(.[]; .type=="project" and .id==$project) and all(.[]; (.type=="project" or .type=="folder" or .type=="organization") and (.id|type=="string"))' <<< "$ancestors" >/dev/null \
    || die 'Incomplete or unrecognized resource ancestry'
  while IFS=$'\t' read -r type id; do
    case "$type" in
      project) policy=$(gcloud projects get-iam-policy "$id" --format=json) || die "Cannot read project policy $id" ;;
      folder) policy=$(gcloud resource-manager folders get-iam-policy "$id" --format=json) || die "Cannot read folder policy $id" ;;
      organization) policy=$(gcloud organizations get-iam-policy "$id" --format=json) || die "Cannot read organization policy $id" ;;
    esac
    printf '%s' "$policy" > "$TMP/ancestor-policy.json"
    check_ancestor_policy "$TMP/ancestor-policy.json"
  done < <(jq -r '.[] | [.type,.id] | @tsv' <<< "$ancestors")
  # Resource policies must also have no unresolved extra grants.
  gcloud run services get-iam-policy "$LAB_NAME-processor" --region="$REGION" --project="$PROJECT_ID" --format=json > "$TMP/processor-policy.json"
  jq -e --arg member "serviceAccount:$PUSH_SA" '
    (.bindings|type=="array") and
    any(.bindings[]; .role=="roles/run.invoker" and (.members|index($member)!=null) and (has("condition")|not)) and
    all(.bindings[]; .role=="roles/run.invoker" and (has("condition")|not) and all(.members[]; .==$member))' "$TMP/processor-policy.json" >/dev/null \
      || die 'Processor direct policy differs from the sole push-account invoker grant'
  gcloud run services get-iam-policy "$LAB_NAME-server" --region="$REGION" --project="$PROJECT_ID" --format=json > "$TMP/server-policy.json"
  jq -e '.bindings|type=="array"' "$TMP/server-policy.json" >/dev/null || die 'Missing server policy'
  jq -e --arg member "serviceAccount:$PUSH_SA" 'all(.bindings[]; (.members|index($member)==null))' "$TMP/server-policy.json" >/dev/null \
    || die 'Push identity has an unexpected direct server grant'
  echo 'PASS: readable ancestor allow policies and lab invocation bindings. Live operations cover only the tested permissions and current request context.'
}
