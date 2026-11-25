#!/usr/bin/env bash
# Install the telemetry stack into the ai-soc cluster: Tetragon, Loki,
# Fluent Bit and Alertmanager. Safe to run repeatedly.
set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=lib.sh
source scripts/lib.sh

TETRAGON_VERSION="1.8.0"
LOKI_VERSION="7.7.0"
FLUENT_BIT_VERSION="0.58.3"
ALERTMANAGER_VERSION="2.5.2"

kc create namespace observability --dry-run=client -o yaml | kc apply -f - >/dev/null

# Alertmanager reads the webhook bearer token from this Secret. The value
# here is a placeholder; the agent deployment step overwrites it.
if ! kc -n observability get secret agent-webhook-token >/dev/null 2>&1; then
  kc -n observability create secret generic agent-webhook-token \
    --from-literal=token=LAB-FAKE-placeholder-token >/dev/null
  log info "created placeholder secret" name=agent-webhook-token
fi

# Loki mounts this ConfigMap as its rules directory. Start empty so Loki
# boots; the detection rules are applied later.
if ! kc -n observability get configmap loki-alert-rules >/dev/null 2>&1; then
  kc -n observability create configmap loki-alert-rules \
    --from-literal=rules.yaml='groups: []' >/dev/null
  log info "created empty rules configmap" name=loki-alert-rules
fi

hc upgrade --install tetragon tetragon --repo https://helm.cilium.io/ --version "$TETRAGON_VERSION" \
  -n kube-system -f infra/tetragon-values.yaml --wait --timeout 8m
hc upgrade --install loki loki --repo https://grafana.github.io/helm-charts --version "$LOKI_VERSION" \
  -n observability -f infra/loki-values.yaml --wait --timeout 8m
hc upgrade --install alertmanager alertmanager \
  --repo https://prometheus-community.github.io/helm-charts --version "$ALERTMANAGER_VERSION" \
  -n observability -f infra/alertmanager-values.yaml --wait --timeout 8m
hc upgrade --install fluent-bit fluent-bit --repo https://fluent.github.io/helm-charts --version "$FLUENT_BIT_VERSION" \
  -n observability -f infra/fluent-bit-values.yaml --wait --timeout 8m

kc -n kube-system rollout status ds/tetragon --timeout=300s
kc -n observability rollout status ds/fluent-bit --timeout=300s
kc -n observability rollout status sts/loki --timeout=300s
kc -n observability rollout status sts/alertmanager --timeout=300s

log info "telemetry stack ready" context="$CTX"
