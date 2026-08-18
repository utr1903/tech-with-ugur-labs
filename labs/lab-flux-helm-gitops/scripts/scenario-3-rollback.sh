#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=scripts/lib.sh
source scripts/lib.sh

echo "=== Scenario 3: a broken upgrade rolls back automatically (GitOps' answer to helm --atomic) ==="

echo "--> Committing v3, whose image tag does not exist anywhere"
fleet_fresh_clone
set_release v3 2 2
fleet_push "Deploy demo-app v3"

echo "--> Flux attempts the upgrade; the hook pod can never start (no such image)."
echo "    upgrade.remediation rolls the release back to the last good revision."

helm_history_shows_rollback() {
  helm history demo-app -n demo -o json \
    | jq -e '[.[] | select(.status == "deployed")] | last | .description | test("Rollback to [0-9]+")' >/dev/null
}

wait_for 300 "helm reports a rollback to a deployed state" helm_history_shows_rollback

echo "--> Helm's own history tells the story:"
helm history demo-app -n demo

echo "--> The running deployment is back on the v2 image:"
image="$(kubectl -n demo get deployment demo-app -o jsonpath='{.spec.template.spec.containers[0].image}')"
echo "    running image: ${image}"
[[ "${image}" == "demo-app:v2" ]] || { echo "FAIL: expected demo-app:v2, got ${image}"; exit 1; }

echo "--> And the app never stopped serving v2:"
app_get_messages | jq -e '.version == 2' >/dev/null || { echo "FAIL: app not serving v2"; exit 1; }
app_get_messages | jq .
echo "=== Scenario 3 passed (Flux will keep retrying v3 — scenario 4 picks up there) ==="
