#!/usr/bin/env bash
# Shared constants and helpers for the scanning-lab scripts. Source, don't execute.
LAB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export LAB_DIR
export TMP_DIR="${LAB_DIR}/tmp"
export EXPECTED="${LAB_DIR}/expected/findings.json"
export CLUSTER="appsec-scan"
export NAMESPACE="appsec-scan"
export VULN_IMAGE="vuln-app-scanning:v1"
export HARDENED_IMAGE="hardened-app-scanning:v1"

log() { echo "[$(basename "${0}")] $*"; }

# expected_ids <stage> <tool>  -> newline-separated IDs from expected/findings.json
expected_ids() {
  jq -r --arg s "$1" --arg t "$2" '.[$s][$t][]' "${EXPECTED}"
}
