#!/usr/bin/env bash
# Shared helpers, sourced by every script.
set -euo pipefail

log() { printf '[%s] %s\n' "$(date -u +%H:%M:%S)" "$*"; }

# Fails fast if kubectl isn't pointed at this lab's cluster, so a stray
# context left over from another lab can't get verified or torn down here.
require_context() {
  local want="kind-lab-thanos"
  local current
  current="$(kubectl config current-context 2>/dev/null || true)"
  if [ "$current" != "$want" ]; then
    log "kubectl context is '${current:-<none>}', expected '${want}'."
    log "Run 'kubectl config use-context ${want}' and try again."
    exit 1
  fi
}

# Waits until every pod is Ready. This does not tolerate Completed pods —
# `kubectl wait --for=condition=Ready --all` still fails on them.
wait_pods_ready() {
  local ns="$1" timeout="${2:-300}"
  log "Waiting for pods in namespace ${ns} (timeout ${timeout}s)..."
  kubectl wait --for=condition=Ready pods --all -n "$ns" --timeout="${timeout}s"
}
