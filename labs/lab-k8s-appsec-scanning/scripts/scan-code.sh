#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=scripts/lib.sh
source scripts/lib.sh

variant="${1:?usage: scan-code.sh <vulnerable|hardened>}"
out="${TMP_DIR}/${variant}"; mkdir -p "${out}"

log "Code stage: Gitleaks (secrets) on ${variant}/app"
# gitleaks exits non-zero when it finds leaks (expected on the vulnerable app);
# --exit-code 0 makes it always exit 0 while still writing the JSON report.
gitleaks dir "${variant}/app" --no-banner --exit-code 0 \
  --config scanners/gitleaks/.gitleaks.toml \
  --report-format json --report-path "${out}/gitleaks.json"

log "Code stage: Semgrep (SAST) on ${variant}/app"
semgrep --config scanners/semgrep/rules.yaml --metrics=off --quiet --json \
  --output "${out}/semgrep.json" "${variant}/app/src"

log "Code stage complete for ${variant}"
