#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=scripts/lib.sh
source scripts/lib.sh

variant="${1:?usage: scan-deploy.sh <vulnerable|hardened>}"
out="${TMP_DIR}/${variant}"; mkdir -p "${out}"

log "Deploy stage: Trivy Kubernetes misconfig on ${variant}/k8s"
trivy config --quiet --format json \
  --output "${out}/trivy-k8s.json" "${variant}/k8s/deployment.yaml"

log "Deploy stage complete for ${variant}"
