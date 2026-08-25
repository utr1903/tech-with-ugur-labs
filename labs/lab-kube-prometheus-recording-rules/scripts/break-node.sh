#!/usr/bin/env bash
# Stops the kubelet on one kind worker so the node goes NotReady.
# The whole cluster is deleted at teardown, so this is safely destructive.
set -euo pipefail
source "$(dirname "$0")/lib.sh"
NODE="${1:-lab-kps-worker2}"
log "Stopping kubelet on ${NODE}..."
docker exec "$NODE" systemctl stop kubelet
