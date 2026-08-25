#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/lib.sh"
log "Deleting kind cluster lab-kps..."
kind delete cluster --name lab-kps
