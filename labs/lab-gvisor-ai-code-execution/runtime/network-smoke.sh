#!/usr/bin/env bash
# A live byte-recording canary prevents timeouts against dead targets from passing.
set -euo pipefail
cluster=${GVISOR_CLUSTER_NAME:-gvisor-code-execution}
node="${cluster}-control-plane"
context="kind-${cluster}"
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
evidence_dir=${1:-/tmp/gvisor-network-smoke}
mkdir -p "$evidence_dir"
rm -f -- "$evidence_dir/result.json"
source "$script_dir/platform.sh"
load_platform
kubeconfig=${GVISOR_KUBECONFIG:-${KUBECONFIG:-/tmp/gvisor-runtime-cache/kubeconfig}}
k() { kubectl --kubeconfig "$kubeconfig" --context "$context" "$@"; }
fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }

if ! k get namespace executor > /dev/null 2> "$evidence_dir/prerequisite.stderr"; then
  fail 'expected live canary controls and gVisor denials; executor bootstrap unavailable'
fi
render_manifest "$script_dir/canary.yaml" | k apply -f -
k rollout status deployment/canary -n runtime-canary --timeout=240s
k create namespace policy-probe --dry-run=client -o yaml | k apply -f -
k delete networkpolicy default-deny-all -n policy-probe --ignore-not-found
pod_ip=$(k get pod -n runtime-canary -l app=runtime-canary -o jsonpath='{.items[0].status.podIP}')
service_ip=$(k get service canary -n runtime-canary -o jsonpath='{.spec.clusterIP}')
node_ip=$(k get node "$node" -o jsonpath='{.status.addresses[?(@.type=="InternalIP")].address}')
test -n "$pod_ip" && test -n "$service_ip" && test -n "$node_ip" || fail 'missing canary routing target'

# Deployment readiness can precede EndpointSlice and kube-proxy propagation.
# Require this canary's actual service and node-port forwarding before controls.
routes_ready=false
for _ in $(seq 1 60); do
  docker exec "$node" iptables-save > "$evidence_dir/canary-ready-iptables.txt"
  if grep -F -- "--to-destination $pod_ip:8080" "$evidence_dir/canary-ready-iptables.txt" > /dev/null &&
     grep -F -- "-d $service_ip/32" "$evidence_dir/canary-ready-iptables.txt" | grep -F -- '--dport 8080' > /dev/null &&
     grep -F -- 'runtime-canary/canary' "$evidence_dir/canary-ready-iptables.txt" | grep -F -- '--dport 30080' > /dev/null; then
    routes_ready=true
    break
  fi
  sleep 1
done
test "$routes_ready" = true || fail 'canary service/node forwarding did not become ready within bounded deadline'

probe() {
  local name=$1 namespace=$2 runtime=$3 expected=$4
  k delete job "$name" -n "$namespace" --ignore-not-found --wait=true --cascade=foreground
  k delete pod -n "$namespace" -l "job-name=$name" --ignore-not-found --wait=true
  k apply -f - <<YAML
apiVersion: batch/v1
kind: Job
metadata:
  name: $name
  namespace: $namespace
spec:
  backoffLimit: 0
  activeDeadlineSeconds: 300
  ttlSecondsAfterFinished: 600
  template:
    spec:
$runtime
      restartPolicy: Never
      terminationGracePeriodSeconds: 1
      automountServiceAccountToken: false
      securityContext:
        runAsNonRoot: true
        runAsUser: 65534
        runAsGroup: 65534
        seccompProfile:
          type: RuntimeDefault
      containers:
        - name: probe
          image: python:3.12.12-slim-bookworm@sha256:$python_digest
          command: [python, -I, -u, -c]
          args:
            - |
              import json
              import socket
              targets = [('pod', '$pod_ip', 8080), ('service', '$service_ip', 8080), ('node', '$node_ip', 30080)]
              results = []
              for path, address, port in targets:
                  try:
                      with socket.create_connection((address, port), timeout=3) as connection:
                          payload = ('GET /$name-' + path + ' HTTP/1.0\r\n\r\n').encode('ascii')
                          connection.sendall(payload)
                          response = connection.recv(128)
                          results.append({'path': path, 'address': address, 'port': port, 'reached': response.startswith(b'HTTP/1.0 200'), 'sent_bytes': len(payload)})
                  except OSError as error:
                      results.append({'path': path, 'address': address, 'port': port, 'reached': False, 'error': str(error), 'errno': error.errno})
              print(json.dumps(results), flush=True)
          resources:
            requests: {cpu: 50m, memory: 64Mi}
            limits: {cpu: '1', memory: 256Mi, ephemeral-storage: 16Mi}
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities:
              drop: [ALL]
YAML
  if ! k wait job "$name" -n "$namespace" --for=condition=Complete --timeout=240s; then
    k get events -n "$namespace" -o json > "$evidence_dir/$name-events.json"
    fail "probe $name did not run to completion"
  fi
  local pod
  pod=$(k get pod -n "$namespace" -l "job-name=$name" -o jsonpath='{.items[0].metadata.name}')
  k get pod "$pod" -n "$namespace" -o json > "$evidence_dir/$name-pod.json"
  k logs "$pod" -n "$namespace" > "$evidence_dir/$name.json"
  python3 - "$evidence_dir/$name.json" "$expected" <<'PY'
import json
import pathlib
import sys
results = json.loads(pathlib.Path(sys.argv[1]).read_text())
expected = sys.argv[2] == 'reachable'
assert [result['path'] for result in results] == ['pod', 'service', 'node']
assert all(result['reached'] is expected for result in results), results
PY
}

probe runc-policy-baseline policy-probe '' reachable
k apply -f - <<'YAML'
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-all
  namespace: policy-probe
spec:
  podSelector: {}
  policyTypes: [Ingress, Egress]
  ingress: []
  egress: []
YAML
probe runc-policy-denied policy-probe '' denied
probe gvisor-denied executor '      runtimeClassName: gvisor' denied
# Recheck live endpoints after both denials, so a crashed canary cannot pass.
probe runc-policy-after runtime-canary '' reachable
k logs deployment/canary -n runtime-canary > "$evidence_dir/canary.jsonl"
python3 - "$evidence_dir" <<'PY'
import json
import pathlib
import sys
directory = pathlib.Path(sys.argv[1])
records = [json.loads(line) for line in (directory / 'canary.jsonl').read_text().splitlines()]
def validate(records):
    allowed = {f'GET /{prefix}-{path} HTTP/1.0\r\n\r\n'
               for prefix in ('runc-policy-baseline', 'runc-policy-after')
               for path in ('pod', 'service', 'node')}
    observed = []
    for record in records:
        count = record.get('received_bytes', 0)
        if count:
            data = record.get('data', '')
            assert data in allowed and count == len(data.encode('ascii')), record
            observed.append(data)
    assert set(observed) == allowed and len(observed) == len(allowed), records
validate(records)
PY
docker exec "$node" cat /etc/containerd/config.toml /etc/containerd/runsc.toml > "$evidence_dir/runtime-config.txt"
docker exec "$node" iptables-save > "$evidence_dir/iptables.txt"
grep -q 'cali-' "$evidence_dir/iptables.txt" || fail 'no installed Calico iptables rule evidence'
k get networkpolicy -n executor -o json > "$evidence_dir/executor-policy.json"
k get networkpolicy -n policy-probe -o json > "$evidence_dir/control-policy.json"
k get pod -n kube-system -l k8s-app=calico-node -o json > "$evidence_dir/calico-pod.json"
k delete job gvisor-denied -n executor --wait=true --cascade=foreground
k delete namespace policy-probe runtime-canary --wait=true
python3 - "$evidence_dir/result.json" <<'PY'
import json
import pathlib
import sys
pathlib.Path(sys.argv[1]).write_text(json.dumps({'canary_pod_service_node_positive_controls': True, 'independent_calico_default_deny': True, 'gvisor_network_denied': True, 'executor_bytes_observed_at_canary': 0, 'unverified_paths': ['api-server', 'metadata', 'dns-udp', 'dns-tcp', 'external-ip', 'ipv6']}, indent=2) + '\n')
PY
printf 'PASS: pod/service/node containment with independent Calico controls\n'
