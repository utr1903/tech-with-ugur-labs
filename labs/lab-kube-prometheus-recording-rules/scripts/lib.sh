#!/usr/bin/env bash
# Shared helpers, sourced by every script.
set -euo pipefail

log() { printf '[%s] %s\n' "$(date -u +%H:%M:%S)" "$*"; }

# Waits until every pod in the namespace is Ready (or Completed).
wait_pods_ready() {
  local ns="$1" timeout="${2:-300}"
  log "Waiting for pods in namespace ${ns} (timeout ${timeout}s)..."
  kubectl wait --for=condition=Ready pods --all -n "$ns" --timeout="${timeout}s"
}
