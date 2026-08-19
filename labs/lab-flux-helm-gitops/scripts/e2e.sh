#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

stage="startup"
trap 'echo; echo "E2E FAILED during: ${stage}"' ERR

run_stage() {
  stage="$1"
  shift
  echo
  echo "################ e2e stage: ${stage} ################"
  "$@"
}

run_stage "clean slate" ./scripts/down.sh
run_stage "bring-up" ./scripts/up.sh
run_stage "scenario 1: encrypted secrets" ./scripts/scenario-1-secrets.sh
run_stage "scenario 2: hook-ordered migration" ./scripts/scenario-2-migration.sh
run_stage "scenario 3: automatic rollback" ./scripts/scenario-3-rollback.sh
run_stage "scenario 4: retries exhausted + recovery" ./scripts/scenario-4-recovery.sh
run_stage "scenario 5: drift detection" ./scripts/scenario-5-drift.sh
run_stage "teardown" ./scripts/down.sh

echo
echo "E2E PASSED: full GitOps loop, all five scenarios."
