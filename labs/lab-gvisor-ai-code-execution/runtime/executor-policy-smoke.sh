#!/usr/bin/env bash
# Validate the installed fixed executor through a dedicated namespace test identity.
set -euo pipefail
runtime_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
: "${GVISOR_KUBECONFIG:?Set the absolute owned kubeconfig}"
: "${GVISOR_CLUSTER_NAME:?Set the owned kind cluster name}"
: "${GVISOR_RUNNER_IMAGE:?Set the actual imported runner image manifest digest}"
case "$GVISOR_KUBECONFIG" in /*) ;; *) exit 1 ;; esac
kube() { kubectl --kubeconfig "$GVISOR_KUBECONFIG" --context "kind-$GVISOR_CLUSTER_NAME" "$@"; }
backend=system:serviceaccount:executor-app:backend
test_user=executor-policy-test
cleanup() { kube delete rolebinding executor-policy-test -n executor --ignore-not-found; kube delete role executor-policy-test -n executor --ignore-not-found; }
trap cleanup EXIT
kube create role executor-policy-test -n executor --verb=create --resource=jobs.batch,pods
kube create rolebinding executor-policy-test -n executor --role=executor-policy-test --user="$test_user"
base=$(jq --arg image "$GVISOR_RUNNER_IMAGE" '.metadata.name="executor-admission-check" | .spec.template.spec.containers[0].image=$image' "$runtime_dir/runner-job.json")
printf '%s\n' "$base" | kube create --dry-run=server --as="$backend" -f -
for kind in Job Pod; do
  if test "$kind" = Job; then object=$base; else object=$(jq '{apiVersion:"v1",kind:"Pod",metadata:.metadata,spec:.spec.template.spec}' <<< "$base"); fi
  printf '%s\n' "$object" | kube create --dry-run=server --as="$test_user" -f -
  for change in 'del(.runtimeClassName)' '.automountServiceAccountToken=true' '.containers[0].image="python:3.12.13-slim"' '.containers[0].command=["sleep","60"]' '.containers[0].args=["extra"]' '.containers[0].env += [{name:"PATH",value:"/tmp"}]' '.containers[0].env[0].value=("é"*8193)' '.containers[0].securityContext.privileged=true' '.containers[0].securityContext.readOnlyRootFilesystem=false' '.containers[0].securityContext.capabilities.add=["NET_ADMIN"]' '.hostNetwork=true' '.hostPID=true' '.hostIPC=true' '.volumes += [{name:"secret",secret:{secretName:"forbidden"}}]' '.volumes += [{name:"host",hostPath:{path:"/"}}]' '.volumes += [{name:"pvc",persistentVolumeClaim:{claimName:"forbidden"}}]' '.initContainers=[.containers[0]]' '.containers += [(.containers[0] | .name="extra")]' 'del(.containers[0].resources)' '.volumes[0].emptyDir.sizeLimit="32Mi"'; do
    if test "$kind" = Job; then mutated=$(jq ".spec.template.spec |= ($change)" <<< "$object"); else mutated=$(jq ".spec |= ($change)" <<< "$object"); fi
    if printf '%s\n' "$mutated" | kube create --dry-run=server --as="$test_user" -f -; then printf 'Invalid template was accepted: %s\n' "$change" >&2; exit 1; fi
  done
done
for operation in 'get secrets' 'create pods' 'create configmaps' 'update pods/ephemeralcontainers'; do
  read -r verb resource <<< "$operation"
  test "$(kube auth can-i "$verb" "$resource" -n executor --as="$backend" || true)" = no
done
printf 'Fixed Job/Pod admission and backend RBAC checks passed\n'
