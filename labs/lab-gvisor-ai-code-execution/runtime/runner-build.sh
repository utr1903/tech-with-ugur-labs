#!/usr/bin/env bash
# Build only the runner context and import its actual OCI manifest into our node.
set -euo pipefail
runtime_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
runner_dir=$(cd -- "$runtime_dir/../runner" && pwd)
archive=${1:?Usage: runner-build.sh /absolute/path/outside/checkout/runner.oci.tar}
case "$archive" in /*) ;; *) printf 'Archive path must be absolute\n' >&2; exit 1 ;; esac
case "$archive" in "$runner_dir"/*|"$runtime_dir"/*) printf 'Keep image archives outside source directories\n' >&2; exit 1 ;; esac
export DOCKER_CONTEXT=${GVISOR_DOCKER_CONTEXT:?Set the owned local Docker context}
cluster=${GVISOR_CLUSTER_NAME:?Set the owned kind cluster name}
node="${cluster}-control-plane"
test "$(docker --context "$DOCKER_CONTEXT" inspect "$node" --format '{{index .Config.Labels "io.x-k8s.kind.cluster"}}')" = "$cluster"
# shellcheck source=platform.sh
source "$runtime_dir/platform.sh"
load_platform
case "$artifact_arch" in x86_64) platform=amd64 ;; aarch64) platform=arm64 ;; esac
(
  cd -- "$runner_dir"
  uv sync --frozen
  uv build --wheel
  uv export --frozen --no-dev --no-emit-project --output-file requirements.txt
  docker --context "$DOCKER_CONTEXT" buildx build --platform "linux/$platform" --provenance=false \
    --build-arg "PYTHON_IMAGE=python:3.12.12-slim-bookworm@sha256:$python_digest" \
    --output "type=oci,dest=$archive" -t twu-python-runner:local .
)
index=$(tar -xOf "$archive" index.json)
test "$(jq '.manifests | length' <<< "$index")" = 1
test "$(jq -r '.manifests[0].platform.architecture' <<< "$index")" = "$platform"
digest=$(jq -er '.manifests[0].digest | select(test("^sha256:[0-9a-f]{64}$"))' <<< "$index")
image="docker.io/library/twu-python-runner@$digest"
docker --context "$DOCKER_CONTEXT" cp "$archive" "$node:/var/tmp/twu-runner.oci.tar"
docker --context "$DOCKER_CONTEXT" exec "$node" stat /var/tmp/twu-runner.oci.tar
docker --context "$DOCKER_CONTEXT" exec "$node" ctr -n k8s.io images import /var/tmp/twu-runner.oci.tar
docker --context "$DOCKER_CONTEXT" exec "$node" ctr -n k8s.io images tag docker.io/library/twu-python-runner:local "$image"
printf '%s\n' "$image"
