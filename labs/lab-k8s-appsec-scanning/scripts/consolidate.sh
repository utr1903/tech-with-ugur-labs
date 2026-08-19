#!/usr/bin/env bash
# Prints the consolidated before/after scan report from the latest tmp/ output.
set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=scripts/lib.sh
source scripts/lib.sh

printf "%-8s %-18s %-40s %-11s %-9s\n" "STAGE" "TOOL" "FINDING" "VULNERABLE" "HARDENED"

clean_count=0
total_count=0
kyverno_line=""

while IFS=' ' read -r stage tool id; do
  if [[ "${tool}" == "kyverno" ]]; then
    vuln_state="denied"
    hard_state="admitted"
    if [[ "$(./scripts/_id_present.sh vulnerable kyverno "${id}")" == "yes" ]]; then
      vuln_state="denied"
    else
      vuln_state="admitted"
    fi
    if [[ -f "${TMP_DIR}/admission/hardened.txt" ]]; then
      hard_state="admitted"
    else
      hard_state="denied"
    fi
    kyverno_line="Kyverno: vulnerable workload ${vuln_state}, hardened workload ${hard_state}"
    printf "%-8s %-18s %-40s %-11s %-9s\n" "${stage}" "${tool}" "${id}" "${vuln_state}" "${hard_state}"
    continue
  fi

  vuln="$(./scripts/_id_present.sh vulnerable "${tool}" "${id}")"
  hard="$(./scripts/_id_present.sh hardened "${tool}" "${id}")"
  printf "%-8s %-18s %-40s %-11s %-9s\n" "${stage}" "${tool}" "${id}" "${vuln}" "${hard}"

  total_count=$((total_count + 1))
  if [[ "${vuln}" == "yes" && "${hard}" == "no" ]]; then
    clean_count=$((clean_count + 1))
  fi
done < <(jq -r 'to_entries[] | .key as $s | .value | to_entries[] | .key as $t | .value[] | "\($s) \($t) \(.)"' "${EXPECTED}")

echo
echo "Summary: ${clean_count}/${total_count} findings present on vulnerable and clean on hardened; ${kyverno_line}"
