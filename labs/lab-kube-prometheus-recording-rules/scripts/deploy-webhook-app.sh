#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/lib.sh

log "Building webhook-app image..."
docker build -t webhook-app:0.1.0 webhook-app
log "Loading image into kind..."
kind load docker-image webhook-app:0.1.0 --name lab-kps
log "Deploying webhook-app..."
kubectl apply -f manifests/webhook-app.yaml
kubectl rollout status -n webhook-app deployment/webhook-app --timeout=120s
