#!/usr/bin/env bash
# Shared helpers. Source this file; do not execute it.
# Kube context is always explicit so the reader's current context is
# never used or changed.

CLUSTER="${KIND_CLUSTER:-ai-soc}"
CTX="kind-${CLUSTER}"

kc() { kubectl --context "$CTX" "$@"; }
hc() { helm --kube-context "$CTX" "$@"; }

log() {
  # log <level> <msg> [key=value ...] -> one JSON line on stderr
  local level="$1" msg="$2"
  shift 2
  local out
  out="$(printf '{"level":"%s","msg":"%s"' "$level" "$msg")"
  local kv
  for kv in "$@"; do
    out+="$(printf ',"%s":"%s"' "${kv%%=*}" "${kv#*=}")"
  done
  printf '%s}\n' "$out" >&2
}

# wait_for <timeout_s> <cmd...>: retry the command every 2 s until it
# succeeds or the timeout passes.
wait_for() {
  local timeout="$1"
  shift
  local deadline=$((SECONDS + timeout))
  until "$@" >/dev/null 2>&1; do
    if ((SECONDS >= deadline)); then
      return 1
    fi
    sleep 2
  done
}

# loki_query <logql> <since_seconds>: print the JSON result of an instant
# range query. Port-forwards svc/loki once per script on a free local port.
# Call `loki_start` once in the main shell first when loki_query is used in
# a pipeline (pipelines run in subshells, which would lose the port).
_LOKI_PORT=""
_LOKI_PF_PID=""

_loki_cleanup() {
  if [[ -n "$_LOKI_PF_PID" ]]; then
    kill "$_LOKI_PF_PID" 2>/dev/null || true
  fi
}

_loki_start() {
  [[ -n "$_LOKI_PORT" ]] && return 0
  _LOKI_PORT="$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1])')"
  kc -n observability port-forward svc/loki "${_LOKI_PORT}:3100" >/dev/null 2>&1 &
  _LOKI_PF_PID=$!
  # Only claim the EXIT trap if the caller has not set its own; callers that
  # do must call _loki_cleanup from it.
  if [[ -z "$(trap -p EXIT)" ]]; then trap _loki_cleanup EXIT; fi
  wait_for 20 curl -fsS "http://127.0.0.1:${_LOKI_PORT}/ready" || {
    log error "loki port-forward not ready"
    return 1
  }
}

loki_start() { _loki_start; }

loki_query() {
  local query="$1" since="$2"
  _loki_start
  local now_ns start_ns
  now_ns="$(python3 -c 'import time; print(int(time.time()*1e9))')"
  start_ns=$((now_ns - since * 1000000000))
  curl -fsS -G "http://127.0.0.1:${_LOKI_PORT}/loki/api/v1/query_range" \
    --data-urlencode "query=${query}" \
    --data-urlencode "start=${start_ns}" \
    --data-urlencode "end=${now_ns}" \
    --data-urlencode "limit=50"
}
