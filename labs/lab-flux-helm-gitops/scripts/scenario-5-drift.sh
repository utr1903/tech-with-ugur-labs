#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=scripts/lib.sh
source scripts/lib.sh

echo "=== Scenario 5 (closer): drift detection reverts manual kubectl edits ==="

echo "--> Someone 'fixes production' by hand:"
kubectl -n demo scale deployment demo-app --replicas=3
kubectl -n demo get deployment demo-app -o jsonpath='replicas now: {.spec.replicas}{"\n"}'

echo "--> Asking Flux to reconcile (normally the 1m interval would catch it):"
flux reconcile helmrelease demo-app -n demo >/dev/null

replicas_corrected_to_one() {
  [[ "$(kubectl -n demo get deployment demo-app -o jsonpath='{.spec.replicas}')" == "1" ]]
}

wait_for 180 "replicas corrected back to 1" replicas_corrected_to_one

echo "--> Git said 1 replica, so it is 1 replica again. The cluster is not the source of truth."
echo "=== Scenario 5 passed ==="
