#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/lib.sh

PROM_URL=http://127.0.0.1:19090
PF_PIDS=()
cleanup() { for pid in "${PF_PIDS[@]:-}"; do kill "$pid" 2>/dev/null || true; done; }
trap cleanup EXIT

start_prom_port_forward() {
  kubectl port-forward -n monitoring svc/kps-kube-prometheus-stack-prometheus 19090:9090 >/dev/null &
  PF_PIDS+=($!)
  for _ in $(seq 1 30); do
    curl -fsS "${PROM_URL}/-/ready" >/dev/null 2>&1 && return 0
    sleep 1
  done
  log "FAIL: Prometheus port-forward never became ready"; return 1
}

prom_query() { curl -fsG "${PROM_URL}/api/v1/query" --data-urlencode "query=$1"; }

# Each recorded metric must exist AND carry a node label that is a
# node name (lab-kps-*), not an IP.
check_recording_rules() {
  local metrics=(
    "node:cpu_utilization:percent"
    "node:memory_utilization:percent"
    "pod:cpu_utilization_vs_limit:percent"
    "pod:memory_utilization_vs_limit:percent"
  )
  for m in "${metrics[@]}"; do
    log "Checking recorded metric ${m}..."
    local deadline=$((SECONDS + 180)) ok=0
    while (( SECONDS < deadline )); do
      local n
      n=$(prom_query "$m" | jq -r '[.data.result[].metric.node // empty] | length')
      local bad
      bad=$(prom_query "$m" | jq -r '[.data.result[].metric.node // "MISSING" | select(test("^lab-kps-") | not)] | length')
      if (( n > 0 && bad == 0 )); then ok=1; break; fi
      sleep 10
    done
    (( ok == 1 )) || { log "FAIL: ${m} missing or node label is not a node name"; return 1; }
  done
  # The two :info rules only produce series while something is unhealthy;
  # assert the rules are loaded instead of asserting series.
  local loaded
  loaded=$(curl -fsS "${PROM_URL}/api/v1/rules?type=record" \
    | jq -r '[.data.groups[].rules[].name] | index("node:unhealthy:info") != null and index("pod:unhealthy:info") != null')
  [[ "$loaded" == "true" ]] || { log "FAIL: unhealthy info rules not loaded"; return 1; }
  log "OK: recording rules"
}

main() {
  wait_pods_ready monitoring
  start_prom_port_forward
  check_recording_rules
  log "verify: all checks passed"
}
main "$@"
