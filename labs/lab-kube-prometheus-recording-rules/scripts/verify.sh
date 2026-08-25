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

# deploy_faults' sizing/poll queries run through a port-forward that can die
# mid-run; under set -euo pipefail a failed prom_query there would abort the
# whole script. Fall back to a default and log it instead of aborting silently.
prom_query_or() {
  local query="$1" filter="$2" default="$3" out
  out=$(prom_query "$query" 2>/dev/null | jq -r "$filter" 2>/dev/null) || out=""
  if [[ -z "$out" ]]; then
    log "WARN: prom_query '${query}' failed or returned empty; using default ${default}"
    out="$default"
  fi
  printf '%s' "$out"
}

# deploy_faults deliberately drives the shared host toward its limits, which
# can make the kind control plane's own API server briefly unreachable (TLS
# handshake timeouts, dropped watches) without the cluster actually being
# broken. A bare kubectl call in that window dies under set -euo pipefail
# with a raw transport error and no diagnosable line. Retry instead of
# letting one transient blip kill the whole script.
kubectl_retry() {
  local attempt
  for attempt in 1 2 3 4 5; do
    if kubectl "$@"; then return 0; fi
    if (( attempt < 5 )); then
      log "WARN: kubectl $* failed (attempt ${attempt}/5); retrying in 5s..."
      sleep 5
    fi
  done
  return 1
}

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

check_webhook_app() {
  log "Checking webhook-app health..."
  wait_pods_ready webhook-app 120
  kubectl delete pod curl-probe -n webhook-app --ignore-not-found >/dev/null 2>&1 || true
  kubectl run curl-probe --rm -i --restart=Never -n webhook-app \
    --image=alpine:3.20.3 --command -- \
    wget -q -O- http://webhook-app.webhook-app.svc:8080/healthz | grep -q '"ok":true' \
    || { log "FAIL: webhook-app /healthz"; return 1; }
  log "OK: webhook-app"
}

GRAFANA_URL=http://127.0.0.1:13000

start_grafana_port_forward() {
  GRAFANA_AUTH="admin:$(kubectl get secret -n monitoring kps-grafana -o jsonpath='{.data.admin-password}' | base64 -d)"
  kubectl port-forward -n monitoring svc/kps-grafana 13000:80 >/dev/null &
  PF_PIDS+=($!)
  for _ in $(seq 1 30); do
    curl -fsS -u "$GRAFANA_AUTH" "${GRAFANA_URL}/api/health" >/dev/null 2>&1 && return 0
    sleep 1
  done
  log "FAIL: Grafana port-forward never became ready"; return 1
}

check_dashboards() {
  for uid in lab-raw-queries lab-recorded-metrics; do
    log "Checking dashboard ${uid}..."
    local deadline=$((SECONDS + 180)) ok=0
    while (( SECONDS < deadline )); do
      curl -fsS -u "$GRAFANA_AUTH" "${GRAFANA_URL}/api/dashboards/uid/${uid}" >/dev/null 2>&1 && { ok=1; break; }
      sleep 10
    done
    (( ok == 1 )) || { log "FAIL: dashboard ${uid} not imported"; return 1; }
  done
  log "OK: dashboards"
}

check_alerting() {
  log "Checking provisioned alerting..."
  local deadline=$((SECONDS + 180)) ok=0
  while (( SECONDS < deadline )); do
    local rules cps
    rules=$(curl -fsS -u "$GRAFANA_AUTH" "${GRAFANA_URL}/api/v1/provisioning/alert-rules" \
      | jq -r '[.[].uid] | sort | join(",")') || rules=""
    cps=$(curl -fsS -u "$GRAFANA_AUTH" "${GRAFANA_URL}/api/v1/provisioning/contact-points" \
      | jq -r '[.[].name] | index("webhook-app") != null') || cps=false
    if [[ "$rules" == "lab-node-cpu-high,lab-node-mem-high,lab-node-unhealthy,lab-pod-cpu-high,lab-pod-mem-high,lab-pod-unhealthy" && "$cps" == "true" ]]; then
      ok=1; break
    fi
    sleep 10
  done
  (( ok == 1 )) || { log "FAIL: alert rules or contact point not provisioned"; return 1; }
  log "OK: alerting"
}

deploy_faults() {
  log "Deploying fault workloads..."
  kubectl_retry apply -f faults/ \
    || { log "FAIL: could not apply faults/ manifests"; return 1; }

  # kind nodes on this host share one kernel, so node-exporter's per-node
  # CPU/memory series are actually host-wide: a single fault pod capped at
  # its own 200m/100m limit can't move node:{cpu,memory}_utilization:percent
  # past 80% by itself. Compute how many replicas are needed from the LIVE
  # environment (cores, current utilization, total memory) instead of a
  # fixed number, so this works on hosts of any size. Per-pod limits stay
  # exactly as committed in faults/*.yaml -- only the replica count scales.
  local cores cur_cpu cur_mem mem_total_bytes
  cores=$(prom_query_or 'count by (instance) (node_cpu_seconds_total{mode="idle"})' '.data.result[0].value[1] // 1' 1)
  cur_cpu=$(prom_query_or 'max(node:cpu_utilization:percent)' '.data.result[0].value[1] // 0' 0)
  cur_mem=$(prom_query_or 'max(node:memory_utilization:percent)' '.data.result[0].value[1] // 0' 0)
  mem_total_bytes=$(prom_query_or 'node_memory_MemTotal_bytes' '.data.result[0].value[1] // 0' 0)

  # cpu-hog is limited to 200m (0.2 core) per pod. NOTE: this deliberately
  # does NOT subtract cur_cpu from the target -- node:cpu_utilization:percent
  # is a rate([5m]) metric, and a live run showed it can carry a transient
  # spike (e.g. from the helm install/image-load that just happened) that
  # decays within the same window we're sizing for. Subtracting a stale high
  # reading under-provisions the fault load and the alert never fires.
  # Sizing purely off cores (a stable signal -- effectively nproc, not a
  # rate) for a fixed target is safe in both directions: if real baseline
  # load is also present, we cross the threshold with more margin; if it
  # isn't (the common case), our own load alone still reaches target.
  # Caps are a runaway guard, not a sizing target -- set high enough that
  # a real host doesn't hit them (see README caveats for the envelope this
  # covers). If a cap does bind, warn loudly instead of silently under-
  # provisioning the fault load. Phase-1 CPU target is 88 (comfortably
  # above the 80 threshold, with a little less aggregate pressure than the
  # 90 this used to run at).
  local cpu_replicas cpu_capped
  read -r cpu_replicas cpu_capped <<< "$(awk -v tgt=88 -v cores="$cores" -v cap=256 'BEGIN {
    v = tgt / 100 * cores / 0.2
    if (v < 1) v = 1
    r = int(v); if (v > r) r++
    capped = 0
    if (r > cap) { r = cap; capped = 1 }
    print r, capped
  }')"
  if (( cpu_capped )); then
    log "WARN: cpu-hog capped at ${cpu_replicas} replicas -- host may be too large for the 80% node thresholds; see README caveats"
  fi
  # mem-hog fills ~110MB per pod of REAL tmpfs memory -- unlike CPU (a rate
  # metric that settles), every replica's fill is additive on top of
  # whatever the host is already using. Sizing off a fixed percentage of
  # total memory with no regard for the current reading (as this used to)
  # can overcommit a host that already has a meaningful baseline: at 65%
  # baseline on an ~8.2Gi VM, an 85%-of-total target added ~6.7Gi on top of
  # ~5.3Gi already in use and saturated the VM, taking the kind API server
  # down with it. Size off the GAP to the target instead (extra_to_target),
  # and separately cap that gap so projected total usage (cur + extra)
  # never exceeds an absolute 90% ceiling even if the target itself is
  # raised later -- two independent min() terms, not one, so a future
  # target bump can't silently reopen this. cur_mem can read stale/high
  # (same rate-metric caveat as CPU); clamping extra at 0 means a stale
  # high reading only under-fills, never overcommits.
  local mem_replicas mem_capped
  read -r mem_replicas mem_capped <<< "$(awk -v tgt=85 -v ceiling=90 -v cur="$cur_mem" -v total="$mem_total_bytes" -v cap=128 'BEGIN {
    fill = 110 * 1024 * 1024
    extra_to_target = (tgt - cur) / 100 * total
    extra_to_ceiling = (ceiling - cur) / 100 * total
    extra = extra_to_target
    if (extra_to_ceiling < extra) extra = extra_to_ceiling
    if (extra < 0) extra = 0
    v = extra / fill
    if (v < 1) v = 1
    r = int(v); if (v > r) r++
    capped = 0
    if (r > cap) { r = cap; capped = 1 }
    print r, capped
  }')"
  if (( mem_capped )); then
    log "WARN: mem-hog capped at ${mem_replicas} replicas -- host may be too large for the 80% node thresholds; see README caveats"
  fi

  log "Sizing faults from live capacity: cores=${cores} cpu%=${cur_cpu} mem%=${cur_mem} memTotal=${mem_total_bytes}B (cpu-hog sizing ignores cpu% -- see comment above; mem-hog sizing subtracts mem% and caps at a 90% ceiling) -> cpu-hog replicas=${cpu_replicas}, mem-hog replicas=${mem_replicas}"
  kubectl_retry scale deployment/cpu-hog -n faults --replicas="$cpu_replicas" \
    || { log "FAIL: could not scale cpu-hog to ${cpu_replicas} replicas"; return 1; }
  kubectl_retry scale deployment/mem-hog -n faults --replicas="$mem_replicas" \
    || { log "FAIL: could not scale mem-hog to ${mem_replicas} replicas"; return 1; }

  # Let the (now much larger) fault fleet actually schedule and start
  # BEFORE pulling a node out from under the scheduler. A live run showed
  # that scaling to dozens of replicas and breaking a node in the same
  # instant creates a rescheduling storm violent enough to starve
  # Prometheus itself (it OOM/CPU-starved and restarted mid-run), burning
  # most of check_alert_delivery's 600s budget on cluster self-recovery
  # instead of alert evaluation. Waiting here keeps the two disruptions
  # sequential instead of compounding. A rollout that doesn't finish inside
  # its timeout is tolerated (`|| true`) by design -- it's a best-effort
  # wait, not a gate -- but it still goes through kubectl_retry so a
  # transient API-server blip gets retried instead of just giving up on
  # the first failed poll.
  kubectl_retry rollout status deployment/cpu-hog -n faults --timeout=120s || true
  kubectl_retry rollout status deployment/mem-hog -n faults --timeout=120s || true

  # break-node.sh defaults to worker2; if webhook-app landed there, stopping
  # its kubelet would take down the alert-delivery target, so break the
  # other worker instead.
  local break_node=lab-kps-worker2
  local webhook_node
  webhook_node=$(kubectl_retry get pod -n webhook-app -l app=webhook-app -o jsonpath='{.items[0].spec.nodeName}') \
    || { log "FAIL: could not determine webhook-app's node after retries"; return 1; }
  [[ -n "$webhook_node" ]] \
    || { log "FAIL: webhook-app pod not found when checking its node"; return 1; }
  if [[ "$webhook_node" == "lab-kps-worker2" ]]; then
    log "webhook-app is running on lab-kps-worker2; breaking lab-kps-worker instead"
    break_node=lab-kps-worker
  fi
  scripts/break-node.sh "$break_node"

  # Wait for the node-level metric to actually cross the alert threshold
  # before easing off cpu-hog. Once it has, LabNodeCpuHigh's own "for: 30s"
  # window can elapse independently of what happens next -- this poll runs
  # on deploy_faults' own time, not check_alert_delivery's 600s budget.
  log "Waiting for node CPU utilization to cross 80% (up to 300s)..."
  local node_cpu_deadline=$((SECONDS + 300)) node_cpu=0 node_cpu_crossed=0
  while (( SECONDS < node_cpu_deadline )); do
    node_cpu=$(prom_query_or 'max(node:cpu_utilization:percent)' '.data.result[0].value[1] // 0' 0)
    if awk -v v="$node_cpu" 'BEGIN { exit !(v + 0 > 80) }'; then
      node_cpu_crossed=1
      break
    fi
    sleep 15
  done
  log "Node CPU utilization: ${node_cpu}%"

  # Sustaining dozens of cpu-hog replicas is what crosses the node-level
  # threshold, but that same contention (all of them competing for the
  # same limited cores) keeps CFS from letting any single pod reach its
  # OWN 200m ceiling -- a live run showed LabPodCpuHigh (own-limit-
  # relative) never fires under that contention even with the node
  # aggregate sitting at 86%+. Ease off ONLY once the node threshold has
  # actually been crossed (it's latched in Prometheus/Grafana at that
  # point and doesn't need sustained load) so at least one pod can reach
  # its own limit. If the poll above timed out instead, easing off now
  # would cut the fault footprint at exactly the moment it should keep
  # pushing -- keep the full fleet and let check_alert_delivery's 600s
  # window give LabNodeCpuHigh the best remaining chance.
  if (( node_cpu_crossed )); then
    local cpu_replicas_settle=$(( cpu_replicas / 4 ))
    (( cpu_replicas_settle < 1 )) && cpu_replicas_settle=1
    log "Easing cpu-hog to ${cpu_replicas_settle} replicas so individual pods can reach their own CPU limit..."
    kubectl_retry scale deployment/cpu-hog -n faults --replicas="$cpu_replicas_settle" \
      || { log "FAIL: could not ease cpu-hog to ${cpu_replicas_settle} replicas"; return 1; }
    kubectl_retry rollout status deployment/cpu-hog -n faults --timeout=120s || true
  else
    log "WARN: node CPU never crossed 80% within 300s -- keeping full cpu-hog fleet"
  fi

  log "Waiting for a cpu-hog pod to cross 80% of its own CPU limit (up to 300s)..."
  local pod_cpu_deadline=$((SECONDS + 300)) pod_cpu=0
  while (( SECONDS < pod_cpu_deadline )); do
    pod_cpu=$(prom_query_or 'max(pod:cpu_utilization_vs_limit:percent{namespace="faults"})' '.data.result[0].value[1] // 0' 0)
    awk -v v="$pod_cpu" 'BEGIN { exit !(v + 0 > 80) }' && break
    sleep 15
  done
  log "Max pod CPU utilization vs own limit in faults namespace: ${pod_cpu}%"
}

# All six alerts must land in the webhook server's JSON logs.
check_alert_delivery() {
  local expected=(LabNodeCpuHigh LabNodeMemHigh LabNodeUnhealthy LabPodCpuHigh LabPodMemHigh LabPodUnhealthy)
  local deadline=$((SECONDS + 600))
  log "Waiting for all ${#expected[@]} alerts to reach webhook-app (up to 600s)..."
  while (( SECONDS < deadline )); do
    local logs missing=()
    logs=$(kubectl logs -n webhook-app deployment/webhook-app --tail=-1)
    for name in "${expected[@]}"; do
      echo "$logs" | grep -F '"alertname":"'"$name"'"' | grep -qF '"Receiving alert succeeded."' \
        || missing+=("$name")
    done
    if (( ${#missing[@]} == 0 )); then log "OK: all alerts delivered"; return 0; fi
    log "Still missing: ${missing[*]}"
    sleep 20
  done
  log "FAIL: alerts never delivered: ${missing[*]}"
  return 1
}

main() {
  wait_pods_ready monitoring
  start_prom_port_forward
  start_grafana_port_forward
  check_recording_rules
  check_webhook_app
  check_dashboards
  check_alerting
  deploy_faults
  check_alert_delivery
  log "verify: all checks passed"
}
main "$@"
