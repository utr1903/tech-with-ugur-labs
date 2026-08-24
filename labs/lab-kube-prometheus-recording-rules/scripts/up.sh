#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/lib.sh

CLUSTER=lab-kps

if ! kind get clusters | grep -qx "$CLUSTER"; then
  log "Creating kind cluster ${CLUSTER}..."
  kind create cluster --name "$CLUSTER" --config kind/cluster.yaml
fi

log "Installing kube-prometheus-stack 88.5.4..."
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts --force-update
helm upgrade --install kps prometheus-community/kube-prometheus-stack \
  --version 88.5.4 \
  --namespace monitoring --create-namespace \
  -f helm/values.yaml \
  --wait --timeout 10m

wait_pods_ready monitoring
log "Cluster up. Grafana: kubectl port-forward -n monitoring svc/kps-grafana 3000:80"
