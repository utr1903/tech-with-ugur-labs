#!/usr/bin/env bash
# Usage: port-forward.sh <service> <port> [namespace]
# Forwards a free local port to svc/<service>:<port> in the background and
# prints the local port on stdout. The forward ends by itself after
# PF_TTL seconds (default 120) so callers need no cleanup.
set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=lib.sh
source scripts/lib.sh

SVC="${1:?usage: port-forward.sh <service> <port> [namespace]}"
PORT="${2:?usage: port-forward.sh <service> <port> [namespace]}"
NS="${3:-soc}"
TTL="${PF_TTL:-120}"

LOCAL="$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1])')"
kubectl --context "$CTX" -n "$NS" port-forward "svc/${SVC}" "${LOCAL}:${PORT}" >/dev/null 2>&1 </dev/null &
PF=$!
disown "$PF" 2>/dev/null || true
(sleep "$TTL"; kill "$PF" 2>/dev/null || true) >/dev/null 2>&1 </dev/null &
disown 2>/dev/null || true

if ! wait_for 20 nc -z 127.0.0.1 "$LOCAL"; then
  kill "$PF" 2>/dev/null || true
  log error "port-forward not ready" service="$SVC" port="$PORT"
  exit 1
fi
echo "$LOCAL"
