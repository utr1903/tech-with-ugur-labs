#!/usr/bin/env bash
# Shared helper: is finding <id> present for <tool> on <variant>?
# Usage: _id_present.sh <variant> <tool> <id>   -> prints "yes" or "no"
set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=scripts/lib.sh
source scripts/lib.sh

variant="${1:?usage: _id_present.sh <variant> <tool> <id>}"
tool="${2:?usage: _id_present.sh <variant> <tool> <id>}"
id="${3:?usage: _id_present.sh <variant> <tool> <id>}"

file="${TMP_DIR}/${variant}/${tool}.json"

present() {
  case "${tool}" in
    gitleaks)
      jq -e --arg id "${id}" 'any(.[]; .RuleID == $id)' "${file}" >/dev/null 2>&1 ;;
    semgrep)
      jq -e --arg id "${id}" 'any(.results[]; .check_id == $id)' "${file}" >/dev/null 2>&1 ;;
    trivy-sca | trivy-image)
      jq -e --arg id "${id}" \
        'any(.Results[]?.Vulnerabilities[]?; .VulnerabilityID == $id)' "${file}" >/dev/null 2>&1 ;;
    trivy-dockerfile | trivy-k8s)
      jq -e --arg id "${id}" \
        'any(.Results[]?.Misconfigurations[]?; .ID == $id)' "${file}" >/dev/null 2>&1 ;;
    kyverno)
      grep -q -- "${id}" "${TMP_DIR}/admission/vulnerable.txt" 2>/dev/null ;;
    *)
      return 1 ;;
  esac
}

if present; then
  echo yes
else
  echo no
fi
