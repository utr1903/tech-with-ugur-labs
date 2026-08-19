#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=scripts/lib.sh
source scripts/lib.sh

./scripts/check-prereqs.sh
mkdir -p tmp

echo "==> 1/8 Starting Gitea (the lab's git remote)"
docker network inspect kind >/dev/null 2>&1 || docker network create kind
docker compose up -d --wait

echo "==> 2/8 Creating the Gitea user and fleet repository"
docker compose exec -T -u git gitea gitea admin user create \
  --username "${GITEA_USER}" --password "${GITEA_PASSWORD}" \
  --email labowner@example.invalid --admin --must-change-password=false \
  2>/dev/null || echo "    (user already exists)"
curl -fsS -u "${GITEA_USER}:${GITEA_PASSWORD}" -X POST \
  -H 'Content-Type: application/json' \
  -d '{"name":"fleet","private":false,"default_branch":"main","auto_init":false}' \
  "${GITEA_HOST}/api/v1/user/repos" >/dev/null 2>&1 || echo "    (repo already exists)"

echo "==> 3/8 Building the demo-app image (v1, v2 and v4 are intentionally the same build:"
echo "        runtime behavior comes from chart values; the tags exist to drive Helm upgrades)"
docker build -q -t demo-app:v1 app/
docker tag demo-app:v1 demo-app:v2
docker tag demo-app:v1 demo-app:v4

echo "==> 4/8 Creating the kind cluster"
kind get clusters 2>/dev/null | grep -qx "${CLUSTER}" || \
  kind create cluster --name "${CLUSTER}" --config infra/kind-config.yaml --wait 120s
POSTGRES_IMAGE="$(yq 'select(.kind == "Deployment") | .spec.template.spec.containers[0].image' config-repo/apps/postgres.yaml)"
docker pull -q "${POSTGRES_IMAGE}"
kind load docker-image --name "${CLUSTER}" demo-app:v1 demo-app:v2 demo-app:v4
# Docker Desktop's containerd image store only keeps the native-platform layers
# for a registry-pulled multi-arch image, but `kind load docker-image` asks ctr
# to import --all-platforms and fails looking for the other platforms' content.
# Load this one image straight from a `docker save` archive instead, without
# the all-platforms flag. The node's /tmp is a noexec tmpfs that `docker cp`
# cannot write into directly, so stage the archive under /var/tmp (backed by
# the node's real volume) instead.
docker save "${POSTGRES_IMAGE}" -o tmp/postgres-image.tar
docker cp tmp/postgres-image.tar "${CLUSTER}-control-plane:/var/tmp/postgres-image.tar"
docker exec "${CLUSTER}-control-plane" \
  ctr --namespace=k8s.io images import --digests --snapshotter=overlayfs /var/tmp/postgres-image.tar >/dev/null
docker exec "${CLUSTER}-control-plane" rm -f /var/tmp/postgres-image.tar
rm -f tmp/postgres-image.tar

echo "==> 5/8 Teaching cluster DNS to resolve 'gitea'"
GITEA_IP="$(docker inspect gitea -f '{{ (index .NetworkSettings.Networks "kind").IPAddress }}')"
kubectl -n kube-system get configmap coredns -o jsonpath='{.data.Corefile}' > tmp/Corefile
if ! grep -q 'gitea' tmp/Corefile; then
  # Insert a hosts block right after the "ready" plugin line.
  sed -i.bak "/^    ready$/a\\
    hosts {\\
        ${GITEA_IP} gitea\\
        fallthrough\\
    }" tmp/Corefile
fi
kubectl -n kube-system create configmap coredns --from-file=Corefile=tmp/Corefile \
  --dry-run=client -o yaml | kubectl apply -f -
kubectl -n kube-system rollout restart deployment coredns
kubectl -n kube-system rollout status deployment coredns --timeout=60s

echo "==> 6/8 Generating secrets and seeding the fleet repo (SOPS-encrypted, nothing plaintext in git)"
[[ -f tmp/age.agekey ]] || age-keygen -o tmp/age.agekey 2>/dev/null
AGE_RECIPIENT="$(grep 'public key' tmp/age.agekey | awk '{ print $4 }')"
[[ -f tmp/api-token ]] || openssl rand -hex 16 | tr -d '\n' > tmp/api-token
[[ -f tmp/pg-password ]] || openssl rand -hex 16 | tr -d '\n' > tmp/pg-password

rm -rf tmp/fleet
mkdir -p tmp/fleet
cp -R config-repo/apps config-repo/charts tmp/fleet/
cat > tmp/secret.plain.yaml <<EOF
apiVersion: v1
kind: Secret
metadata:
  name: demo-secrets
  namespace: demo
type: Opaque
stringData:
  apiToken: $(cat tmp/api-token)
  pgPassword: $(cat tmp/pg-password)
EOF
sops --encrypt --age "${AGE_RECIPIENT}" \
  --encrypted-regex '^(data|stringData)$' \
  tmp/secret.plain.yaml > tmp/fleet/apps/secret.enc.yaml
rm tmp/secret.plain.yaml

git -C tmp/fleet init --quiet -b main
git -C tmp/fleet -c user.name=labowner -c user.email=labowner@example.invalid \
  add -A
git -C tmp/fleet -c user.name=labowner -c user.email=labowner@example.invalid \
  commit --quiet -m "Initial fleet configuration"
git -C tmp/fleet push --quiet --force "${FLEET_PUSH_URL}" main

echo "==> 7/8 Installing Flux and pointing it at the fleet repo"
flux install
kubectl -n flux-system create secret generic sops-age \
  --from-file=age.agekey=tmp/age.agekey \
  --dry-run=client -o yaml | kubectl apply -f -
kubectl apply -f infra/flux-sync.yaml

echo "==> 8/8 Waiting for the first reconciliation"
wait_for 300 "GitRepository fetched" gitrepo_ready_is_true
wait_for 300 "Kustomization applied" kustomization_ready_is_true
wait_for 300 "HelmRelease Ready" hr_ready_is_true
wait_for 120 "app answering with the decrypted token" app_get_messages

echo
echo "GitOps loop is up:"
echo "  Gitea UI:   ${GITEA_HOST} (${GITEA_USER} / ${GITEA_PASSWORD})"
echo "  App:        ${APP_URL}/api/messages (token in tmp/api-token)"
echo "  Watch Flux: flux get helmreleases -n demo --watch"
