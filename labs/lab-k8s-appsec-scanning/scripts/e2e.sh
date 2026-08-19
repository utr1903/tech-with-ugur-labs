#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=scripts/lib.sh
source scripts/lib.sh

stage="startup"
trap 'echo; echo "E2E FAILED during: ${stage}"' ERR

run_stage() { stage="$1"; shift; echo; echo "######## e2e stage: ${stage} ########"; "$@"; }

scan_variant() {
  local variant="$1"
  ./scripts/scan-code.sh "${variant}"
  ./scripts/scan-build.sh "${variant}"
  ./scripts/scan-deploy.sh "${variant}"
}

assert_all_present() {
  local variant="$1" missing=()
  while IFS=' ' read -r s t id; do
    [[ "${t}" == "kyverno" ]] && continue
    [[ "$(./scripts/_id_present.sh "${variant}" "${t}" "${id}")" == "yes" ]] \
      || missing+=("${s}/${t}/${id}")
  done < <(jq -r 'to_entries[] | .key as $s | .value | to_entries[] | .key as $t | .value[] | "\($s) \($t) \(.)"' "${EXPECTED}")
  if [[ "${#missing[@]}" -gt 0 ]]; then
    echo "missing on ${variant}: ${missing[*]}" >&2
    return 1
  fi
  echo "OK: every non-kyverno finding present on ${variant}"
}

assert_all_absent() {
  local variant="$1" leaked=()
  while IFS=' ' read -r s t id; do
    [[ "${t}" == "kyverno" ]] && continue
    [[ "$(./scripts/_id_present.sh "${variant}" "${t}" "${id}")" == "no" ]] \
      || leaked+=("${s}/${t}/${id}")
  done < <(jq -r 'to_entries[] | .key as $s | .value | to_entries[] | .key as $t | .value[] | "\($s) \($t) \(.)"' "${EXPECTED}")
  if [[ "${#leaked[@]}" -gt 0 ]]; then
    echo "leaked on ${variant}: ${leaked[*]}" >&2
    return 1
  fi
  echo "OK: every non-kyverno finding clean on ${variant}"
}

run_stage "clean tmp" bash -c 'rm -rf tmp && mkdir -p tmp'
run_stage "scan vulnerable" scan_variant vulnerable
run_stage "scan hardened" scan_variant hardened
run_stage "assert vulnerable findings present" assert_all_present vulnerable
run_stage "assert hardened findings clean" assert_all_absent hardened
run_stage "admission control" ./scripts/admission.sh all
run_stage "consolidated report" ./scripts/consolidate.sh

echo
echo "E2E PASSED: every finding present on the vulnerable app, clean on the hardened app; Kyverno denied the vulnerable workload and admitted the hardened one."
