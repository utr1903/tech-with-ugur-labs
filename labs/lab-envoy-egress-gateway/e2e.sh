#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

RUN_SECONDS="${RUN_SECONDS:-120}"
export RUN_SECONDS

PROM="http://localhost:9090/api/v1/query"
GRAFANA="http://localhost:3000"
failures=0

pass() { echo "  PASS  $1"; }
fail() { echo "  FAIL  $1"; failures=$((failures + 1)); }
check() { if [ "$1" = "true" ]; then pass "$2"; else fail "$2 (got: $3)"; fi }

# Returns the single scalar value of an instant query, or 0 when it has no result.
promq() {
  curl -sG --data-urlencode "query=$1" "$PROM" \
    | jq -r 'if (.data.result | length) == 0 then "0" else .data.result[0].value[1] end'
}

# Returns the number of series an instant query matched.
promcount() {
  curl -sG --data-urlencode "query=$1" "$PROM" | jq -r '.data.result | length'
}

cleanup() {
  echo "==> Tearing down..."
  docker compose down -v >/dev/null 2>&1 || true
}
trap cleanup EXIT

# Start from zero. This gate reconciles the gateway's cumulative counters against
# a single run's totals, so a stack left running from a previous `docker compose
# up` would carry its request counts forward and fail that comparison.
echo "==> Removing any stack left over from a previous run..."
docker compose down -v >/dev/null 2>&1 || true

echo "==> Bringing up the workload network, the gateway, the destinations and the dashboard..."
docker compose up -d --build

echo "==> Waiting for both workloads to finish their ${RUN_SECONDS}s run..."
docker wait "$(docker compose ps -q client-checkout)" "$(docker compose ps -q client-batch)" >/dev/null

# The workloads have exited, so Envoy's counters are frozen; wait for one more
# scrape (5s interval) to land before querying, with margin.
echo "==> Waiting for the final scrape to land..."
sleep 12

# npm prints its own non-JSON preamble before the app's log lines, so every line
# is parsed leniently and anything that is not JSON is skipped.
summary_of() {
  docker compose logs --no-log-prefix "$1" \
    | jq -c -R 'fromjson? | select(.msg == "Egress run summary.")' | tail -n 1
}
checkout_summary=$(summary_of client-checkout)
batch_summary=$(summary_of client-batch)
if [ -z "$checkout_summary" ] || [ -z "$batch_summary" ]; then
  echo "  FAIL  both workloads print a run summary"
  exit 1
fi

echo
echo "1. Traffic flowed through the gateway"
for cluster in payments cdn telemetry; do
  n=$(promq "envoy_cluster_upstream_rq_total{envoy_cluster_name=\"$cluster\"}")
  check "$(awk -v n="$n" 'BEGIN { print (n > 0) ? "true" : "false" }')" "the gateway forwarded requests to $cluster" "$n"
done
gateway_total=$(promq 'sum(envoy_cluster_upstream_rq_total)')
client_total=$(( $(echo "$checkout_summary" | jq -r .totalSuccesses) + $(echo "$batch_summary" | jq -r .totalSuccesses) ))
check "$(awk -v a="$gateway_total" -v b="$client_total" 'BEGIN { print (a == b) ? "true" : "false" }')" \
  "the gateway's request count matches what the workloads report" "gateway=$gateway_total workloads=$client_total"

echo
echo "2. Volume is attributed to the right destination"
rx_payments=$(promq 'envoy_cluster_upstream_cx_rx_bytes_total{envoy_cluster_name="payments"}')
rx_cdn=$(promq 'envoy_cluster_upstream_cx_rx_bytes_total{envoy_cluster_name="cdn"}')
rx_telemetry=$(promq 'envoy_cluster_upstream_cx_rx_bytes_total{envoy_cluster_name="telemetry"}')
check "$(awk -v t="$rx_telemetry" -v c="$rx_cdn" -v p="$rx_payments" 'BEGIN { print (t > c && c > p) ? "true" : "false" }')" \
  "telemetry moved more bytes than the CDN, which moved more than payments" \
  "telemetry=$rx_telemetry cdn=$rx_cdn payments=$rx_payments"

# Every response body is exactly PAYLOAD_BYTES, and the histogram buckets are
# powers of two bracketing each payload, so the median must land in the bucket
# (PAYLOAD_BYTES/2, PAYLOAD_BYTES].
assert_p50() {
  local cluster="$1" expected="$2"
  local p50
  p50=$(promq "histogram_quantile(0.5, sum by (le) (rate(envoy_cluster_upstream_rs_body_size_bucket{envoy_cluster_name=\"$cluster\"}[5m])))")
  check "$(awk -v v="$p50" -v e="$expected" 'BEGIN { print (v > e/2 && v <= e) ? "true" : "false" }')" \
    "$cluster's median response body matches its ${expected}-byte payload" "p50=$p50"
}
assert_p50 payments 2048
assert_p50 cdn 65536
assert_p50 telemetry 524288

echo
echo "3. The allow-list held"
denied_4xx=$(promq 'sum(envoy_http_downstream_rq_xx{envoy_http_conn_manager_prefix="egress",envoy_response_code_class="4"})')
check "$(awk -v n="$denied_4xx" 'BEGIN { print (n >= 2) ? "true" : "false" }')" \
  "the gateway denied both workloads' off-list requests" "4xx=$denied_4xx"
shadow_series=$(promcount 'envoy_cluster_upstream_rq_total{envoy_cluster_name=~".*shadow.*"}')
check "$([ "$shadow_series" = "0" ] && echo true || echo false)" \
  "no cluster exists for the off-list destination" "series=$shadow_series"
for summary in "$checkout_summary" "$batch_summary"; do
  who=$(echo "$summary" | jq -r .client)
  status=$(echo "$summary" | jq -r .denied.status)
  body=$(echo "$summary" | jq -r .denied.bodyPreview)
  check "$([ "$status" = "403" ] && echo true || echo false)" "$who was answered 403 by the gateway" "status=$status"
  case "$body" in
    *"egress denied: destination not in allow-list"*) pass "$who saw the gateway's denial message" ;;
    *) fail "$who saw the gateway's denial message (got: $body)" ;;
  esac
done

echo
echo "4. There is no way out except the gateway"
for summary in "$checkout_summary" "$batch_summary"; do
  who=$(echo "$summary" | jq -r .client)
  blocked=$(echo "$summary" | jq -r .bypass.blocked)
  stage=$(echo "$summary" | jq -r .bypass.stage)
  code=$(echo "$summary" | jq -r .bypass.code)
  check "$([ "$blocked" = "true" ] && echo true || echo false)" \
    "$who could not reach a destination without the gateway" "stage=$stage code=$code"
done
log_hits=$(docker compose logs --no-log-prefix egress-proxy | grep -c 'payments-direct.example.com' || true)
check "$([ "$log_hits" = "0" ] && echo true || echo false)" \
  "the bypass attempt left no trace in the gateway's access log" "lines=$log_hits"

# Same claim one layer lower: hand a workload the destination's raw IP address,
# with no name resolution involved, and it still has no route to it. The address
# lookup is deliberately not allowed to abort the script: if it fails, that is a
# failed assertion like any other, not a silent exit under `set -e`.
direct_ip=$(docker inspect -f '{{ (index .NetworkSettings.Networks (printf "%s_egress_net" (index .Config.Labels "com.docker.compose.project"))).IPAddress }}' \
  "$(docker compose ps -q upstream-payments)" 2>/dev/null) || direct_ip=""
if [ -z "$direct_ip" ]; then
  fail "a workload has no route to the destination's IP address (could not read the destination's address off egress_net)"
elif docker compose run --rm --no-deps -T client-checkout npm run bypass-probe -- "$direct_ip" 8080 > /tmp/egress-bypass-probe.log 2>&1; then
  pass "a workload has no route to the destination's IP address ($direct_ip)"
else
  fail "a workload has no route to the destination's IP address ($direct_ip)"
  cat /tmp/egress-bypass-probe.log
fi
rm -f /tmp/egress-bypass-probe.log

# The admin interface is the meter, and it can do a great deal more than serve
# statistics. It is bound to the ops network, which the workloads are not on, so
# the same probe must fail against it too.
if docker compose run --rm --no-deps -T client-checkout npm run bypass-probe -- 10.30.0.10 9901 > /tmp/egress-admin-probe.log 2>&1; then
  pass "a workload cannot reach the gateway's admin interface on the ops network"
else
  fail "a workload cannot reach the gateway's admin interface on the ops network"
  cat /tmp/egress-admin-probe.log
fi
rm -f /tmp/egress-admin-probe.log

echo
echo "5. The dashboard is real"
db=$(curl -s "$GRAFANA/api/health" | jq -r .database)
check "$([ "$db" = "ok" ] && echo true || echo false)" "Grafana is healthy" "database=$db"
code=$(curl -s -o /tmp/egress-dashboard.json -w '%{http_code}' "$GRAFANA/api/dashboards/uid/envoy-egress")
check "$([ "$code" = "200" ] && echo true || echo false)" "the egress dashboard is provisioned" "http=$code"
panels=$(jq -r '.dashboard.panels | length' /tmp/egress-dashboard.json 2>/dev/null || echo 0)
check "$([ "$panels" = "9" ] && echo true || echo false)" "the dashboard has all nine panels" "panels=$panels"
rm -f /tmp/egress-dashboard.json

echo
if [ "$failures" -eq 0 ]; then
  echo "==> All assertions passed."
  exit 0
fi
echo "==> $failures assertion(s) failed."
exit 1
