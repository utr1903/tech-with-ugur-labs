#!/usr/bin/env bash
# Integration test against the named disposable cluster, without runtime mocks.
set -euo pipefail
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
source "$script_dir/platform.sh"
load_platform
cluster=${GVISOR_CLUSTER_NAME:-gvisor-code-execution}
kubeconfig=${GVISOR_KUBECONFIG:-${KUBECONFIG:-/tmp/gvisor-runtime-cache/kubeconfig}}
k() { kubectl --kubeconfig "$kubeconfig" --context "kind-$cluster" "$@"; }
source "$script_dir/pod-wait.sh"
cleanup() { k delete job pod-wait-probe -n executor --ignore-not-found --wait=true --cascade=foreground; }
trap cleanup EXIT
cleanup
render_manifest "$script_dir/python-job.yaml" | sed -e 's/name: runtime-smoke/name: pod-wait-probe/' | awk '/^spec:$/ {print; print "  suspend: true"; next} {print}' | k apply -f -
if k wait pod -n executor -l job-name=pod-wait-probe --for=condition=Ready --timeout=3s; then
  printf 'FAIL: suspended Job unexpectedly had a Ready pod\n' >&2
  exit 1
fi
started=$SECONDS
if wait_job_ready_pod pod-wait-probe executor 3; then
  printf 'FAIL: absent pod unexpectedly passed discovery\n' >&2
  exit 1
fi
test "$((SECONDS - started))" -le 8
(
  sleep 2
  k patch job pod-wait-probe -n executor --type=merge -p '{"spec":{"suspend":false}}' >&2
) &
patch_pid=$!
pod=$(wait_job_ready_pod pod-wait-probe executor 240)
wait "$patch_pid"
job_uid=$(k get job pod-wait-probe -n executor -o jsonpath='{.metadata.uid}')
owner_uid=$(k get pod "$pod" -n executor -o jsonpath='{.metadata.ownerReferences[?(@.controller==true)].uid}')
test "$owner_uid" = "$job_uid"
test "$(k get pod "$pod" -n executor -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}')" = True
printf 'PASS: absent pod fails bounded discovery; delayed exact Job-owned pod reaches Ready\n'
