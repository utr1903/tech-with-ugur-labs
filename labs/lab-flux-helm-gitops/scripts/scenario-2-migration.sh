#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=scripts/lib.sh
source scripts/lib.sh

echo "=== Scenario 2: upgrade v1 -> v2 with a pre-upgrade migration hook ==="

echo "--> Current state: version 1, body-only messages"
app_get_messages | jq .

echo "--> Committing the v2 release (new image tag, APP_VERSION=2, migrate to schema 2)"
fleet_fresh_clone
set_release v2 2 2
fleet_push "Deploy demo-app v2 with the author column migration"

migrate_2_v2_succeeded() {
  [[ "$(kubectl -n demo get job demo-app-migrate-2-v2 -o jsonpath='{.status.succeeded}' 2>/dev/null)" == "1" ]]
}

rollout_v2_complete() {
  kubectl -n demo rollout status deployment demo-app --timeout=10s >/dev/null 2>&1
}

wait_for 300 "migration job for schema 2 completed" migrate_2_v2_succeeded
wait_for 300 "v2 rollout complete" rollout_v2_complete
wait_for 120 "HelmRelease Ready again" hr_ready_is_true

echo "--> Proving hook ordering: the migration finished BEFORE the v2 pod started"
job_done="$(kubectl -n demo get job demo-app-migrate-2-v2 -o jsonpath='{.status.completionTime}')"
# Compare against the pod's running.startedAt (not status.startTime): startTime is set
# the moment the pod object is created and can land in the same second as the job's
# completionTime, making a plain string compare flaky. running.startedAt is recorded
# once the container is actually up, which is safely later. Also filter to a pod that
# is actually running and take the most recently started one, since a rolling update
# with replicas=1 can briefly show the outgoing v1 pod alongside the new v2 one.
pod_start="$(kubectl -n demo get pods -l app.kubernetes.io/name=demo-app -o json \
  | jq -r '[.items[] | select(.status.containerStatuses[0].state.running != null)]
      | sort_by(.status.startTime) | last | .status.containerStatuses[0].state.running.startedAt')"
echo "    migration completed: ${job_done}"
echo "    v2 pod started:      ${pod_start}"
[[ "${job_done}" < "${pod_start}" ]] || { echo "FAIL: pod started before the migration finished"; exit 1; }
echo "OK: hook ran first"

echo "--> The new schema is live (messages now carry an author):"
body="$(app_get_messages)"
echo "${body}" | jq .
echo "${body}" | jq -e '.version == 2 and (.messages | map(has("author")) | all)' >/dev/null \
  || { echo "FAIL: v2 response is missing author fields"; exit 1; }

echo "=== Scenario 2 passed ==="
