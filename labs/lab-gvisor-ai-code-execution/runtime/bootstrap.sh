#!/usr/bin/env bash
# Creates only this lab's named cluster. Run against a verified Linux amd64 Docker host.
set -euo pipefail
cluster=gvisor-code-execution
node="${cluster}-control-plane"
context="kind-${cluster}"
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
cache_dir=${1:-/tmp/gvisor-runtime-cache}
mkdir -p "$cache_dir"
command -v bzip2 > /dev/null || { printf 'Requires bzip2 for the pinned gVisor archive\n' >&2; exit 1; }
test "$(docker info --format '{{.OSType}} {{.Architecture}}')" = 'linux x86_64' || { printf 'Requires a verified Linux x86_64 Docker host\n' >&2; exit 1; }
test "$(kind version | awk '{print $2}')" = v0.32.0 || { printf 'Requires kind v0.32.0\n' >&2; exit 1; }
if kind get clusters | grep -Fxq "$cluster"; then
  printf 'Named cluster already exists; inspect or explicitly tear it down before bootstrap\n' >&2
  exit 1
fi
curl -fL -o "$cache_dir/gvisor-x86_64.tar.bz2" 'https://github.com/google/gvisor/releases/download/release-20260907.0/gvisor-x86_64.tar.bz2'
printf '81416511897ab8abd4e723d66823c5b0461a2ee3311cfa70d152404ef9b860cf  %s\n' "$cache_dir/gvisor-x86_64.tar.bz2" | sha256sum -c -
mkdir -p "$cache_dir/gvisor"
tar -xjf "$cache_dir/gvisor-x86_64.tar.bz2" -C "$cache_dir/gvisor"
curl -fL -o "$cache_dir/calico-upstream.yaml" 'https://raw.githubusercontent.com/projectcalico/calico/v3.31.3/manifests/calico.yaml'
printf '4b2e4053abc87427c214128f0e1b065d2f0dbadeb6be4ca3bdc6754e33af0ca7  %s\n' "$cache_dir/calico-upstream.yaml" | sha256sum -c -
sed \
  -e 's|quay.io/calico/node:v3.31.3|docker.io/calico/node:v3.31.3@sha256:8e8d25f4d0bf0f1ed4e7ce864d789ea948830c1c4377994fa4032d3093095295|g' \
  -e 's|quay.io/calico/cni:v3.31.3|docker.io/calico/cni:v3.31.3@sha256:08b508bec6b7cc2fd35d7ad340f28ff265f7589feacd217a56ccc6aa0cd98634|g' \
  -e 's|quay.io/calico/kube-controllers:v3.31.3|docker.io/calico/kube-controllers:v3.31.3@sha256:65a824efe37bad955e45a9a37492d8db862f6b7c99bc58ac99cf18915a23ee26|g' \
  "$cache_dir/calico-upstream.yaml" > "$cache_dir/calico.yaml"
# With the default CNI disabled, NodeReady must wait until after Calico installation.
kind create cluster --name "$cluster" --config "$script_dir/kind.yaml" --retain --wait 0s
docker cp "$cache_dir/gvisor/." "$node:/usr/local/bin/"
docker cp "$script_dir/runtime.sha256" "$node:/usr/local/share/gvisor-runtime.sha256"
docker cp "$script_dir/runsc.toml" "$node:/etc/containerd/runsc.toml"
docker exec "$node" sha256sum -c /usr/local/share/gvisor-runtime.sha256
docker exec "$node" /usr/local/bin/runsc --version
docker exec "$node" systemctl restart containerd
kubectl --context "$context" apply -f "$cache_dir/calico.yaml"
kubectl --context "$context" -n kube-system rollout status daemonset/calico-node --timeout=300s
kubectl --context "$context" -n kube-system rollout status deployment/calico-kube-controllers --timeout=300s
kubectl --context "$context" wait node --all --for=condition=Ready --timeout=300s
kubectl --context "$context" apply -f "$script_dir/executor.yaml"
printf 'Bootstrap complete; runtime/network tests are separate mandatory checks\n'
