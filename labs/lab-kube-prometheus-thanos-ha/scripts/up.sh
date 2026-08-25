#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/lib.sh

CLUSTER=lab-thanos

if kind get clusters | grep -qx "$CLUSTER"; then
  log "Reusing existing kind cluster ${CLUSTER} (run 'make down' first for a truly fresh start)."
else
  log "Creating kind cluster ${CLUSTER}..."
  kind create cluster --name "$CLUSTER" --config kind/cluster.yaml
fi
