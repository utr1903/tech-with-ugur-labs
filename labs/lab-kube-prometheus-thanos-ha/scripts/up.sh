#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/lib.sh

CLUSTER=lab-thanos

if kind get clusters | grep -qx "$CLUSTER"; then
  log "Reusing existing kind cluster ${CLUSTER} (run 'make down' first for a truly fresh start)."
else
  log "Creating kind cluster ${CLUSTER}..."
  kind create cluster --name "$CLUSTER" --config kind/cluster.yaml
fi

log "Installing the vanilla kube-prometheus-stack (control group)..."
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts --force-update
helm upgrade --install kps-vanilla prometheus-community/kube-prometheus-stack \
  --version 88.5.4 \
  --namespace monitoring-vanilla --create-namespace \
  -f helm/values-vanilla.yaml \
  --wait --timeout 10m

log "Installing the sharded + replicated kube-prometheus-stack with Thanos sidecars..."
helm upgrade --install kps-thanos prometheus-community/kube-prometheus-stack \
  --version 88.5.4 \
  --namespace monitoring-thanos --create-namespace \
  -f helm/values-thanos.yaml \
  --wait --timeout 10m

log "Deploying Thanos Query and the per-shard services..."
kubectl apply -f thanos/query.yaml -f thanos/shard-services.yaml
kubectl rollout status deployment/thanos-query -n monitoring-thanos --timeout=180s

log "Provisioning the comparison dashboard..."
kubectl create configmap comparison-dashboard \
  --namespace monitoring-thanos \
  --from-file=comparison.json=dashboards/comparison.json \
  --dry-run=client -o yaml | kubectl apply -f -
kubectl label configmap comparison-dashboard -n monitoring-thanos grafana_dashboard=1 --overwrite

log "Cluster up."
log "  Vanilla Prometheus: http://127.0.0.1:30900"
log "  Shard 0:            http://127.0.0.1:30901"
log "  Shard 1:            http://127.0.0.1:30902"
log "  Thanos Query:       http://127.0.0.1:30903"
log "  Grafana:            http://127.0.0.1:30904 (admin / see 'kubectl get secret -n monitoring-thanos kps-thanos-grafana')"
