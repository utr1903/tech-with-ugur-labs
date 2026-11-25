#!/usr/bin/env bash
# Build the tenants image, load it into the kind cluster and deploy the
# mock tenants. Safe to run repeatedly.
set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=lib.sh
source scripts/lib.sh

IMAGE="lab-ai-soc/tenants:local"

log info "building image" image="$IMAGE"
docker build -t "$IMAGE" apps/tenants >/dev/null
kind load docker-image "$IMAGE" --name "$CLUSTER" >/dev/null

kc apply -f k8s/tenants/namespaces.yaml >/dev/null

# The ConfigMap is generated from the SQL file so there is one source.
kc -n payments create configmap postgres-init \
  --from-file=postgres-init.sql=k8s/tenants/postgres-init.sql \
  --dry-run=client -o yaml | kc apply -f - >/dev/null

# Random passwords are generated once and kept across re-runs.
if ! kc -n payments get secret postgres-users >/dev/null 2>&1; then
  kc -n payments create secret generic postgres-users \
    --from-literal=postgres_password="$(openssl rand -hex 16)" \
    --from-literal=payments_app_password="$(openssl rand -hex 16)" >/dev/null
  log info "created secret" name=postgres-users
fi

kc apply -f k8s/tenants/rbac.yaml \
  -f k8s/tenants/payments.yaml \
  -f k8s/tenants/storefront.yaml \
  -f k8s/tenants/batch.yaml \
  -f k8s/tenants/ci.yaml >/dev/null

# Pick up a rebuilt image on re-runs.
kc -n storefront rollout restart deploy/storefront >/dev/null
kc -n payments rollout restart deploy/payments-api >/dev/null
kc -n ci rollout restart deploy/ci-runner >/dev/null

kc -n payments rollout status statefulset/postgres --timeout=180s
for target in storefront/storefront payments/payments-api ci/ci-runner; do
  kc -n "${target%%/*}" rollout status "deploy/${target##*/}" --timeout=180s
done
log info "tenants ready"
