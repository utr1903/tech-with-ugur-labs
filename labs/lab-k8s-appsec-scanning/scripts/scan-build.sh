#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=scripts/lib.sh
source scripts/lib.sh

variant="${1:?usage: scan-build.sh <vulnerable|hardened>}"
out="${TMP_DIR}/${variant}"; mkdir -p "${out}"
case "${variant}" in
  vulnerable) image="${VULN_IMAGE}" ;;
  hardened)   image="${HARDENED_IMAGE}" ;;
  *) echo "unknown variant: ${variant}" >&2; exit 2 ;;
esac

log "Build stage: Trivy SCA (dependencies) on ${variant}/app"
trivy fs --scanners vuln --quiet --format json \
  --output "${out}/trivy-sca.json" "${variant}/app"

log "Build stage: Trivy Dockerfile misconfig on ${variant}/app"
trivy config --quiet --format json \
  --output "${out}/trivy-dockerfile.json" "${variant}/app/Dockerfile"

log "Build stage: docker build ${image}"
docker build -q -t "${image}" "${variant}/app" >/dev/null

log "Build stage: Trivy image scan on ${image}"
trivy image --scanners vuln --quiet --format json \
  --output "${out}/trivy-image.json" "${image}"

log "Build stage complete for ${variant}"
