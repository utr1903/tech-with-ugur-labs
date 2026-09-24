#!/usr/bin/env bash
# Exercise real IAM orchestration with HTTP/cloud authentication replaced at the boundary.
set -euo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd)
source "$root/scripts/common.sh"
source "$root/scripts/e2e_http.sh"
source "$root/scripts/e2e_iam.sh"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
PROJECT_ID=test-project
BUCKET=test-project-number-pipeline-results
TOPIC=projects/test-project/topics/number-pipeline
SERVER_SA=server@example.com
PROCESSOR_SA=processor@example.com
PUSH_SA=push@example.com
PROCESSOR_URL=https://processor.example.run.app
READER_TOKEN=reader
CLEANUP_OBJECTS=()
export REQUESTS="$TMP/requests"
gcloud() {
  [[ "${NO_IMPERSONATION:-false}" != true ]] || return 1
  case "$*" in *server@example.com*) echo server;; *processor@example.com*) echo processor;; *) echo push;; esac
}
curl() {
  local output='' method='' token='' url='' previous='' arg status=200 body='{}'
  for arg in "$@"; do
    case "$previous" in -o) output=$arg;; -X) method=$arg;; -H) if [[ "$arg" == 'Authorization: Bearer '* ]]; then token=${arg#Authorization: Bearer }; fi;; esac
    previous=$arg
    if [[ "$arg" == https://* ]]; then url=$arg; fi
  done
  echo "$token $method $url" >> "$REQUESTS"
  case "$url" in
    *processor.example.run.app*) status=${PROCESSOR_STATUS:-404};;
    *pubsub.googleapis.com*)
      if [[ "$token" == server ]]; then body='{"messageIds":["123"]}'; else status=403; body='{"error":{"code":403,"message":"pubsub.topics.publish"}}'; fi;;
    *storage.googleapis.com*)
      if [[ "$token" == reader ]]; then
        if [[ "$method" == DELETE ]]; then status=${CLEANUP_CODE:-204}; else body='{"name":"object.txt","generation":"42"}'; fi
      elif [[ "$token" == processor && "$url" == *'ifGenerationMatch=0' ]]; then
        body='{"name":"object.txt","generation":"42"}'
      else
        status=403
        case "$method $url" in
          GET*alt=media) body='{"error":{"code":403,"message":"storage.objects.get"}}';;
          GET*) body='{"error":{"code":403,"message":"storage.objects.list"}}';;
          DELETE*) body='{"error":{"code":403,"message":"storage.objects.delete"}}';;
          POST*ifGenerationMatch=42) body='{"error":{"code":403,"message":"storage.objects.delete"}}';;
          POST*) body='{"error":{"code":403,"message":"storage.objects.create"}}';;
        esac
        if [[ "${BAD_ALLOW:-false}" == true && "$token" == server && "$method" == POST ]]; then status=200; fi
      fi;;
  esac
  printf '%s' "$body" > "$output"
  printf '%s' "$status"
}
verify_iam > "$TMP/out"
[[ ${#CLEANUP_OBJECTS[@]} == 2 ]] || { echo 'FAIL: server create probe not registered for cleanup'; exit 1; }
[[ $(wc -l < "$REQUESTS" | tr -d ' ') == 13 ]] || { echo 'FAIL: incomplete IAM operation matrix'; exit 1; }
grep -q 'processor POST .*ifGenerationMatch=42' "$REQUESTS" || { echo 'FAIL: overwrite did not use existing generation'; exit 1; }
: > "$REQUESTS"
if ( NO_IMPERSONATION=true verify_iam ) > "$TMP/out" 2>&1; then echo 'FAIL: impersonation failure swallowed'; exit 1; fi
[[ ! -s "$REQUESTS" ]] || { echo 'FAIL: API operations after failed impersonation'; exit 1; }
if ( BAD_ALLOW=true verify_iam ) > "$TMP/out" 2>&1; then echo 'FAIL: unexpected permission allowed'; exit 1; fi
if ( PROCESSOR_STATUS=204 verify_iam ) > "$TMP/out" 2>&1; then echo 'FAIL: external authenticated processor invocation allowed'; exit 1; fi
# Cleanup runs with the reader and a failed cleanup must make the verifier fail.
if ( CLEANUP_CODE=403 cleanup_objects ) > "$TMP/out" 2>&1; then echo 'FAIL: cleanup failure swallowed'; exit 1; fi
echo 'PASS: IAM operation matrix, impersonation separation, unexpected grants, cleanup failure'
