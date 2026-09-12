#!/usr/bin/env bash
# Real runtime contract: missing/mislabeled handlers and runc fallback must fail.
set -euo pipefail
cluster=gvisor-code-execution
node="${cluster}-control-plane"
context="kind-${cluster}"
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
evidence_dir=${1:-/tmp/gvisor-runtime-smoke}
mkdir -p "$evidence_dir"
k() { kubectl --context "$context" "$@"; }
source "$script_dir/pod-wait.sh"
fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }
runtime_backed_up=false
restore_handler() {
  if test "$runtime_backed_up" = true; then
    docker exec "$node" sh -c 'cp /etc/containerd/config.before-runtime-drill.toml /etc/containerd/config.toml && systemctl restart containerd'
    runtime_backed_up=false
  fi
}
trap restore_handler EXIT
capture_stdout() {
  local destination=$1 capture_pod=$2
  for _ in $(seq 1 60); do
    k logs "$capture_pod" -n executor -c python > "$destination"
    if test -s "$destination"; then return; fi
    sleep 1
  done
  fail 'ready Python container produced no output before bounded capture deadline'
}

if ! k get namespace executor > /dev/null 2> "$evidence_dir/prerequisite.stderr"; then
  fail 'expected runnable gVisor Python Job; executor namespace unavailable'
fi
k delete job runtime-smoke invalid-runtime-smoke -n executor --ignore-not-found --wait=true --cascade=foreground
k delete pod -n executor -l 'job-name in (runtime-smoke,invalid-runtime-smoke)' --ignore-not-found --wait=true
k apply -f "$script_dir/python-job.yaml"
if ! pod=$(wait_job_ready_pod runtime-smoke executor 240); then
  k get events -n executor -o json > "$evidence_dir/runtime-events.json"
  fail 'expected gVisor Job to launch Python; pod did not become ready'
fi
k get pod "$pod" -n executor -o json > "$evidence_dir/python-pod.json"
capture_stdout "$evidence_dir/python.stdout" "$pod"
printf '42\n' > "$evidence_dir/expected.stdout"
cmp "$evidence_dir/expected.stdout" "$evidence_dir/python.stdout" || fail 'Python stdout must be exactly 42 plus newline'

sandbox_id=$(docker exec "$node" crictl pods --name "^${pod}$" --namespace executor -q)
test -n "$sandbox_id" || fail 'Python pod has no live sandbox'
docker exec "$node" crictl inspectp "$sandbox_id" > "$evidence_dir/sandbox.json"
container_id=$(k get pod "$pod" -n executor -o jsonpath='{.status.containerStatuses[?(@.name=="python")].containerID}')
docker exec "$node" crictl inspect "${container_id#containerd://}" > "$evidence_dir/python-container.json"
docker exec "$node" sha256sum -c /usr/local/share/gvisor-runtime.sha256 > "$evidence_dir/runtime-checksums.txt"
docker exec -i "$node" sh -s -- "$sandbox_id" > "$evidence_dir/live-runtime.txt" <<'SH'
set -eu
sandbox_id=$1
found=false
for proc in /proc/[0-9]*; do
  executable=$(readlink "$proc/exe" 2>/dev/null || true)
  case "$executable" in
    /usr/local/bin/runsc|/usr/local/bin/gvisor-bin/gvisor_sentry)
      command_line=$(tr '\000' ' ' < "$proc/cmdline" 2>/dev/null || true)
      case "$command_line" in
        *"$sandbox_id"*)
          printf 'pid=%s executable=%s sandbox=%s command=%s\n' "${proc##*/}" "$executable" "$sandbox_id" "$command_line"
          sha256sum "$proc/exe"
          live_digest=$(sha256sum "$proc/exe" | cut -d ' ' -f 1)
          installed_digest=$(sha256sum "$executable" | cut -d ' ' -f 1)
          test "$live_digest" = "$installed_digest"
          found=true
          ;;
      esac
      ;;
  esac
done
test "$found" = true
SH
test -s "$evidence_dir/live-runtime.txt" || fail 'no checksum-verified live gVisor executable correlated with the Python sandbox'
python3 - "$evidence_dir" <<'PY'
import json
import pathlib
import sys
directory = pathlib.Path(sys.argv[1])
sandbox = json.loads((directory / 'sandbox.json').read_text())
container = json.loads((directory / 'python-container.json').read_text())
pod = json.loads((directory / 'python-pod.json').read_text())
assert sandbox['info']['runtimeType'] == 'io.containerd.runsc.v1'
assert container['info']['runtimeType'] == 'io.containerd.runsc.v1'
assert container['info']['sandboxID'] == sandbox['status']['id']
assert sandbox['status']['metadata']['uid'] == pod['metadata']['uid']
assert container['info']['runtimeSpec']['annotations']['io.kubernetes.cri.sandbox-uid'] == pod['metadata']['uid']
prefix = f"pid={sandbox['info']['pid']} executable=/usr/local/bin/gvisor-bin/gvisor_sentry sandbox={sandbox['status']['id']}"
assert any(line.startswith(prefix) and '--network=none' in line and '--platform=systrap' in line for line in (directory / 'live-runtime.txt').read_text().splitlines()), 'actual Python sandbox lacks live checksum-matched Sentry with disabled networking'
PY

k delete job runtime-smoke -n executor --wait=true --cascade=foreground
docker exec "$node" cp /etc/containerd/config.toml /etc/containerd/config.before-runtime-drill.toml
runtime_backed_up=true
docker exec "$node" sh -c 'sed -i "s/runtimes.runsc/runtimes.disabled-runsc/g" /etc/containerd/config.toml && systemctl restart containerd'
docker exec "$node" cat /etc/containerd/config.toml > "$evidence_dir/invalid-handler-config.toml"
sed -e 's/name: runtime-smoke/name: invalid-runtime-smoke/' "$script_dir/python-job.yaml" | k apply -f -
invalid_pod=''
for _ in $(seq 1 30); do
  invalid_pod=$(k get pod -n executor -l job-name=invalid-runtime-smoke -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)
  if test -n "$invalid_pod"; then break; fi
  sleep 1
done
test -n "$invalid_pod" || fail 'invalid-handler Job produced no pod to inspect'
for _ in $(seq 1 60); do
  k get events -n executor --field-selector "involvedObject.name=${invalid_pod}" -o json > "$evidence_dir/invalid-events.json"
  if grep -q 'no runtime for.*runsc' "$evidence_dir/invalid-events.json"; then break; fi
  sleep 1
done
grep -q 'no runtime for.*runsc' "$evidence_dir/invalid-events.json" || fail 'missing configured gvisor handler produced no explicit runtime failure evidence'
k get pod "$invalid_pod" -n executor -o json > "$evidence_dir/invalid-pod.json"
invalid_containers=$(docker exec "$node" crictl ps -a --name python -o json)
printf '%s\n' "$invalid_containers" > "$evidence_dir/containers.json"
python3 - "$evidence_dir" "$invalid_pod" <<'PY'
import json
import pathlib
import sys

directory = pathlib.Path(sys.argv[1])
pod = json.loads((directory / 'invalid-pod.json').read_text())
assert not any(status.get('state', {}).get('running') or status.get('state', {}).get('terminated') for status in pod.get('status', {}).get('containerStatuses', [])), 'invalid handler launched Python'
containers = json.loads((directory / 'containers.json').read_text())['containers']
assert not any(container.get('labels', {}).get('io.kubernetes.pod.name') == sys.argv[2] for container in containers), 'invalid handler created a Python container'
PY
k delete job invalid-runtime-smoke -n executor --wait=true --cascade=foreground
restore_handler
k apply -f "$script_dir/python-job.yaml"
restored_pod=$(wait_job_ready_pod runtime-smoke executor 240)
capture_stdout "$evidence_dir/restored-python.stdout" "$restored_pod"
cmp "$evidence_dir/expected.stdout" "$evidence_dir/restored-python.stdout" || fail 'restored configured gvisor handler did not execute benign Python'
k delete job runtime-smoke -n executor --wait=true --cascade=foreground
python3 - "$evidence_dir" <<'PY'
import json
import pathlib
import sys
directory = pathlib.Path(sys.argv[1])
(directory / 'result.json').write_text(json.dumps({'python_stdout': (directory / 'python.stdout').read_text(), 'live_runtime_evidence': (directory / 'live-runtime.txt').read_text(), 'invalid_handler_launched_python': False, 'restored_handler_python_stdout': (directory / 'restored-python.stdout').read_text()}, indent=2) + '\n')
PY
printf 'PASS: genuine Python runtime and missing-handler fail-closed contract\n'
