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
