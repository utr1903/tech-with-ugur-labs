#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/lib.sh

wait_pods_ready monitoring-vanilla
wait_pods_ready monitoring-thanos

log "Installing verifier dependencies..."
(cd verifier && npm ci)

log "Running verifier suite: ${1:-all}"
(cd verifier && npx tsx src/index.ts "${1:-all}")
