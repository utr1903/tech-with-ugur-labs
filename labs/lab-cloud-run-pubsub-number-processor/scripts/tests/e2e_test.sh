#!/usr/bin/env bash
# Wrong HTTP denial codes, uncorrelated logs, or overlooked ancestors must fail.
set -euo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
export TMP="$tmp" PROJECT_ID=test-project REGION=europe-west1 LAB_NAME=number-pipeline
export E2E_TIMEOUT=1 E2E_OBSERVE=1 E2E_INTERVAL=1
source "$root/scripts/common.sh"
[[ -f "$root/scripts/e2e_http.sh" ]] || { echo 'FAIL: missing e2e HTTP verifier'; exit 1; }
source "$root/scripts/e2e_http.sh"
source "$root/scripts/e2e_policy.sh"
curl() { local prev='' arg; for arg in "$@"; do if [[ "$prev" == '-o' ]]; then printf '%s' "${BODY}" > "$arg"; fi; prev=$arg; done; printf '%s' "$CODE"; }
export -f curl
expect_failure() { if ( "$@" ) > "$tmp/out" 2>&1; then echo "FAIL: accepted $*"; exit 1; fi; }
for status in 400 401 404 409 500; do CODE=$status BODY='{"error":{"code":403,"message":"storage.objects.get"}}' expect_failure denied token GET url storage.objects.get; done
CODE=403 BODY='{"error":{"code":403,"message":"storage.objects.get denied"}}' denied token GET url storage.objects.get
CODE=403 BODY='{"error":{"code":403,"message":"unrelated permission"}}' expect_failure denied token GET url storage.objects.get
CODE=403 BODY='{"error":{"code":401,"message":"storage.objects.get"}}' expect_failure denied token GET url storage.objects.get
CODE=403 BODY='{"error":{"code":403,"status":"PERMISSION_DENIED","message":"User not authorized to perform this action."}}' denied token POST url pubsub.topics.publish
printf '%s' '{"bindings":[{"role":"roles/editor","members":["serviceAccount:number-pipeline-server@test-project.iam.gserviceaccount.com"]}]}' > "$tmp/policy"
expect_failure check_ancestor_policy "$tmp/policy"
printf '%s' '{"bindings":[{"role":"roles/viewer","members":["group:team@example.com"]}]}' > "$tmp/policy"
expect_failure check_ancestor_policy "$tmp/policy"
printf '%s' '{"bindings":[{"role":"roles/owner","members":["user:reader@example.com"]}]}' > "$tmp/policy"
check_ancestor_policy "$tmp/policy"
printf '%s' '{}' > "$tmp/policy"
expect_failure check_ancestor_policy "$tmp/policy"
# External-command seam called by sourced polling functions.
# shellcheck disable=SC2329
gcloud() { echo '[]'; }
expect_failure wait_processed target-message stored
# Even if the logging API returns unrelated data, it is not success.
# External-command seam called by sourced polling functions.
# shellcheck disable=SC2329
gcloud() { echo '[{"jsonPayload":{"event":"processed","message_id":"wrong-message","outcome":"stored","object_name":"wrong.txt"}}]'; }
expect_failure wait_processed target-message stored
# External-command seam called by sourced polling functions.
# shellcheck disable=SC2329
gcloud() { echo '[{"jsonPayload":{"event":"processed","message_id":"target-message","outcome":"stored","object_name":"a.txt"}}]'; }
[[ $(wait_processed target-message stored | jq -r '.object_name') == a.txt ]]
echo 'PASS: exact permission evidence, conservative policies, correlated bounded logs'
