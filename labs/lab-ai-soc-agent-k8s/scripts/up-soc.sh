#!/usr/bin/env bash
# Build the SOC image, load it into the cluster and deploy the agent, the
# responder, their RBAC, the network policies and the hunt CronJob. Run
# `make secrets` first. Safe to run repeatedly.
set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=lib.sh
source scripts/lib.sh

IMAGE="lab-ai-soc/soc:local"

log info "building image" image="$IMAGE"
docker build -t "$IMAGE" apps/soc >/dev/null
kind load docker-image "$IMAGE" --name "$CLUSTER" >/dev/null

for s in anthropic soc-tokens; do
  kc -n soc get secret "$s" >/dev/null 2>&1 || {
    log error "secret missing; run: make secrets" name="$s"
    exit 1
  }
done

# Where the API server really is: the control-plane node (port 6443) and the
# "kubernetes" Service ClusterIP (port 443).
NODE_IP="$(kc get endpointslice -l kubernetes.io/service-name=kubernetes \
  -o jsonpath='{.items[0].endpoints[0].addresses[0]}')"
SVC_IP="$(kc get svc kubernetes -o jsonpath='{.spec.clusterIP}')"
if [[ -z "$NODE_IP" || -z "$SVC_IP" ]]; then
  log error "could not read the API server addresses" node="$NODE_IP" svc="$SVC_IP"
  exit 1
fi
log info "api server addresses" node="$NODE_IP" service="$SVC_IP"

kc apply -f k8s/soc/namespace.yaml \
  -f k8s/soc/reader-rbac.yaml \
  -f k8s/soc/responder-rbac.yaml \
  -f k8s/soc/responder-admission.yaml >/dev/null
sed -e "s#__API_SERVER_NODE_IP__#${NODE_IP}#g" -e "s#__API_SERVER_SVC_IP__#${SVC_IP}#g" \
  k8s/soc/networkpolicies.yaml | kc apply -f - >/dev/null
kc apply -f k8s/soc/responder.yaml \
  -f k8s/soc/agent.yaml \
  -f k8s/soc/hunt-cronjob.yaml >/dev/null

# Pick up a rebuilt image on re-runs.
kc -n soc rollout restart deploy/soc-responder deploy/soc-agent >/dev/null
kc -n soc rollout status deploy/soc-responder --timeout=180s
kc -n soc rollout status deploy/soc-agent --timeout=180s
log info "soc ready"
