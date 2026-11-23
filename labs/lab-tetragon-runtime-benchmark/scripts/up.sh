#!/usr/bin/env bash
# Create the kind cluster, install Tetragon and deploy the lab workloads.
# Safe to run repeatedly.
set -euo pipefail
cd "$(dirname "$0")/.."

CLUSTER="${KIND_CLUSTER:-tetragon-bench}"
CTX="kind-${CLUSTER}"
TETRAGON_VERSION="1.8.0"

make cluster KIND_CLUSTER="$CLUSTER"

for image in victim attacker webapp; do
  docker build -t "lab/${image}:1" "images/${image}"
  kind load docker-image "lab/${image}:1" --name "$CLUSTER"
done

helm repo add cilium https://helm.cilium.io/ --force-update >/dev/null
helm upgrade --install tetragon cilium/tetragon --version "$TETRAGON_VERSION" \
  --kube-context "$CTX" -n kube-system -f infra/tetragon-values.yaml
kubectl --context "$CTX" -n kube-system rollout status ds/tetragon --timeout=180s

kubectl --context "$CTX" apply -f k8s/namespaces.yaml
kubectl --context "$CTX" apply -f k8s/victim.yaml -f k8s/attacker.yaml -f k8s/webapp.yaml
kubectl --context "$CTX" -n victim wait --for=condition=Ready pod --all --timeout=120s
kubectl --context "$CTX" -n attacker wait --for=condition=Ready pod --all --timeout=120s

pod="$(kubectl --context "$CTX" -n kube-system get pods -l app.kubernetes.io/name=tetragon -o name | head -n1)"
kubectl --context "$CTX" -n kube-system exec "$pod" -c tetragon -- tetra status
