#!/usr/bin/env bash
# Creates only this lab's named cluster on a supported Linux Docker daemon.
set -euo pipefail
cluster=${GVISOR_CLUSTER_NAME:-gvisor-code-execution}
node="${cluster}-control-plane"
context="kind-${cluster}"
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
source "$script_dir/platform.sh"
load_platform
cache_dir=${1:-/tmp/gvisor-runtime-cache}
mkdir -p "$cache_dir"
command -v bzip2 > /dev/null || { printf 'Requires bzip2 for the pinned gVisor archive\n' >&2; exit 1; }
test "$(kind version | awk '{print $2}')" = v0.32.0 || { printf 'Requires kind v0.32.0\n' >&2; exit 1; }
if kind get clusters | grep -Fxq "$cluster"; then
  printf 'Named cluster already exists; inspect or explicitly tear it down before bootstrap\n' >&2
  exit 1
fi
curl -fL -o "$cache_dir/gvisor-${artifact_arch}.tar.bz2" "https://github.com/google/gvisor/releases/download/release-20260907.0/gvisor-${artifact_arch}.tar.bz2"
printf '%s  %s\n' "$archive_digest" "$cache_dir/gvisor-${artifact_arch}.tar.bz2" | sha256sum -c -
mkdir -p "$cache_dir/gvisor"
tar -xjf "$cache_dir/gvisor-${artifact_arch}.tar.bz2" -C "$cache_dir/gvisor"
curl -fL -o "$cache_dir/calico-upstream.yaml" 'https://raw.githubusercontent.com/projectcalico/calico/v3.31.3/manifests/calico.yaml'
printf '4b2e4053abc87427c214128f0e1b065d2f0dbadeb6be4ca3bdc6754e33af0ca7  %s\n' "$cache_dir/calico-upstream.yaml" | sha256sum -c -
sed \
  -e "s|# - name: CALICO_IPV4POOL_CIDR|- name: CALICO_IPV4POOL_CIDR|" \
  -e "s|#   value: \"192.168.0.0/16\"|  value: \"$pod_subnet\"|" \
  -e "s|quay.io/calico/node:v3.31.3|docker.io/calico/node:v3.31.3@sha256:${calico_node}|g" \
  -e "s|quay.io/calico/cni:v3.31.3|docker.io/calico/cni:v3.31.3@sha256:${calico_cni}|g" \
  -e "s|quay.io/calico/kube-controllers:v3.31.3|docker.io/calico/kube-controllers:v3.31.3@sha256:${calico_controllers}|g" \
  "$cache_dir/calico-upstream.yaml" > "$cache_dir/calico.yaml"
# With the default CNI disabled, NodeReady must wait until after Calico installation.
render_manifest "$script_dir/kind.yaml" > "$cache_dir/kind.yaml"
kind create cluster --name "$cluster" --config "$cache_dir/kind.yaml" --retain --wait 0s --kubeconfig "$cache_dir/kubeconfig"
docker cp "$cache_dir/gvisor/." "$node:/usr/local/bin/"
docker cp "$script_dir/runtime-${artifact_arch}.sha256" "$node:/usr/local/share/gvisor-runtime.sha256"
docker cp "$script_dir/runsc.toml" "$node:/etc/containerd/runsc.toml"
docker exec "$node" sha256sum -c /usr/local/share/gvisor-runtime.sha256
docker exec "$node" /usr/local/bin/runsc --version
docker exec "$node" systemctl restart containerd
kubectl --kubeconfig "$cache_dir/kubeconfig" --context "$context" apply -f "$cache_dir/calico.yaml"
kubectl --kubeconfig "$cache_dir/kubeconfig" --context "$context" -n kube-system rollout status daemonset/calico-node --timeout=300s
kubectl --kubeconfig "$cache_dir/kubeconfig" --context "$context" -n kube-system rollout status deployment/calico-kube-controllers --timeout=300s
kubectl --kubeconfig "$cache_dir/kubeconfig" --context "$context" wait node --all --for=condition=Ready --timeout=300s
kubectl --kubeconfig "$cache_dir/kubeconfig" --context "$context" apply -f "$script_dir/executor.yaml"
printf 'Bootstrap complete; runtime/network tests are separate mandatory checks\n'
