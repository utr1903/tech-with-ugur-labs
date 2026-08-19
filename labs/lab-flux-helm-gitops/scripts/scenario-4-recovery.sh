#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=scripts/lib.sh
source scripts/lib.sh

echo "=== Scenario 4: 'upgrade retries exhausted' — the stuck state and its deliberate recovery ==="

echo "--> Waiting for Flux to give up on v3 (retries: 2 means three failed attempts total)..."
echo "    This takes a few minutes: each attempt waits out the 2m per-attempt timeout."
echo "    Under this helm-controller, exhaustion shows up as a separate Stalled condition"
echo "    (reason RetriesExceeded), not as wording inside the Ready message."

hr_retries_exhausted() {
  [[ "$(hr_stalled_reason)" == "RetriesExceeded" ]]
}

wait_for 900 "HelmRelease Stalled condition reports RetriesExceeded" hr_retries_exhausted

echo "--> The stuck state, verbatim:"
echo "    Stalled: $(hr_stalled_message)"
echo "    Ready:   $(hr_ready_message)"
echo

echo "--> Note what Flux does now: nothing. No retry loop, no self-recovery."
echo "    Forcing reconciliation of the same broken spec does not help:"
flux reconcile helmrelease demo-app -n demo || true
sleep 5
[[ "$(hr_ready_status)" == "False" ]] || { echo "FAIL: expected the release to stay stuck"; exit 1; }
[[ "$(hr_stalled_reason)" == "RetriesExceeded" ]] || { echo "FAIL: expected Stalled/RetriesExceeded to persist"; exit 1; }
echo "OK: still stuck — only a spec change (or suspend/resume) resets the retry budget"

echo "--> The recovery: fix the desired state in git. Committing working v4."
fleet_fresh_clone
set_release v4 2 2
fleet_push "Deploy demo-app v4"

hr_ready_is_true_after_fix() {
  [[ "$(hr_ready_status)" == "True" ]]
}

wait_for 300 "HelmRelease Ready after the fix" hr_ready_is_true_after_fix

image="$(kubectl -n demo get deployment demo-app -o jsonpath='{.spec.template.spec.containers[0].image}')"
[[ "${image}" == "demo-app:v4" ]] || { echo "FAIL: expected demo-app:v4, got ${image}"; exit 1; }
app_get_messages | jq -e '.version == 2' >/dev/null || { echo "FAIL: app not serving after recovery"; exit 1; }
echo "--> Recovered: running ${image}, release Ready."
echo "    (The other documented recovery, when there is nothing to change in git:"
echo "     flux suspend helmrelease demo-app -n demo && flux resume helmrelease demo-app -n demo)"
echo "=== Scenario 4 passed ==="
