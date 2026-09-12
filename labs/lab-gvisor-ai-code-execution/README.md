# Contained Python execution with gVisor on Kubernetes

This lab builds a fixed Python runner and launches disposable Jobs through gVisor. The runtime gate checks a live checksum-matched Sentry, disables the configured handler to prove there is no ordinary-runtime fallback, and verifies three TCP routes against independent positive controls and Calico default-deny controls.

The verified local host path is native ARM64 Docker Desktop on macOS. Linux x86_64 image and executable pins are retained; sustained full-system QEMU TCG execution is not a supported reader path. Kubernetes 1.33.1 is a feasibility compatibility candidate; current security support has not been assessed. The runtime, CNI, Kubernetes administrator and Docker host remain trusted.

Prerequisites: Linux ARM64 or x86_64 Docker engine, kind `v0.32.0`, kubectl `v1.33.1`, Helm, Bash, Python 3.12/uv, jq, curl, bzip2 and sha256sum. Node configuration pins Calico `v3.31.3`, Python `3.12.12-slim-bookworm` and gVisor `release-20260907.0` through platform-specific manifest digests and verified archive/executable checksums.

From this directory, use an explicit owned Docker context, cluster name and kubeconfig. Bootstrap refuses to overwrite an existing named cluster. Run the initial runtime/network gates **before** installing the fixed-runner admission policy: their base-Python feasibility Jobs intentionally use a different image/interface.

```sh
export GVISOR_DOCKER_CONTEXT=desktop-linux
export DOCKER_CONTEXT="$GVISOR_DOCKER_CONTEXT"
export GVISOR_CLUSTER_NAME=gvisor-code-execution
cache="${TMPDIR:-/tmp}/gvisor-runtime-cache"
export GVISOR_KUBECONFIG="$cache/kubeconfig"
bash runtime/bootstrap.sh "$cache"
bash runtime/runtime-smoke.sh
bash runtime/network-smoke.sh
bash runtime/pod-wait-test.sh

export GVISOR_RUNNER_IMAGE=$(bash runtime/runner-build.sh "$cache/runner.oci.tar" | tail -n 1)
helm template executor charts/executor --set-string "runnerImage=$GVISOR_RUNNER_IMAGE" |
  kubectl --kubeconfig "$GVISOR_KUBECONFIG" --context "kind-$GVISOR_CLUSTER_NAME" apply -f -
bash runtime/executor-policy-smoke.sh
bash runtime/executor-resource-smoke.sh
```

The build context contains only the runner's wheel and hash-locked requirements. The importer uses the actual OCI manifest digest, verifies architecture and loads `image@sha256:…` with `imagePullPolicy: Never`; a Docker configuration ID is not used as an image pin. Chart values contain the verified ARM64 runner digest; rebuilding on another host requires passing its newly imported manifest reference as shown above.

The runner accepts only `PYTHON_SOURCE`, bounded to 16 KiB of UTF-8. It invokes isolated Python with a fixed minimal environment, no stdin, a non-root UID, read-only root, dropped capabilities and no privilege escalation. The fixed `/work` memory emptyDir has a verified 16 MiB tmpfs mount; an actual multiple-file probe fails with `ENOSPC` near that bound. CPU is 500m, memory 128 MiB and ephemeral-storage declarations are 32 MiB. The execution namespace has default-deny ingress/egress, including DNS, and the verified runsc handler additionally uses `network=none`.

An inherited hard `RLIMIT_NPROC=32` bounds the untrusted child's fork and thread creation in the verified gVisor release. Actual probes reach 29 additional children/threads and fail further creation; an administrator's runtime/proc observations show 31 runner-container tasks plus the sandbox pause task. Kubelet `podPidsLimit: 128` limits host tasks and is **not** the evidence for the guest bound. The guest process limit, core/file-size/open-file limits and supervisor dumpability hardening are defense in depth: source and its same-UID supervisor are one untrusted unit. Source can kill or stop the supervisor.

The child watchdog is 10 seconds; the external Job deadline is 20 seconds with no retries. A killed supervisor produces a failed container; a stopped supervisor is terminated by the external Job deadline. Container exit 124 is advisory and cannot alone establish a trusted timeout because source can select that exit code. Kubernetes Job deadline conditions, container termination reason/exit and runtime observations supply classification; printed success/status fields never override them. Actual memory exhaustion produces `OOMKilled`, with early captured diagnostics retained.

Captured stdout/stderr are JSON data frames: `captureVersion: 1`, a stream name and base64 for at most 1024 raw bytes per frame. Each stream retains at most 8192 bytes, flushes its first partial output early, then coalesces later writes. The final capture/truncation fields are untrusted advisories. The future backend must cap aggregate retrieval/parser input to 32768 bytes, independently clamp raw and UTF-8 text bytes, retain complete diagnostic chunks before malformed/incomplete frames and reject missing final capture on an otherwise successful container. Kubelet log rotation is configured to 1 MiB and two files; rotation is periodic, not an instantaneous node-storage quota.

Fail-closed admission checks both Jobs and Pods against the complete defaulted specification: only the pinned image, command, bounded source, fixed resources/security context and memory work volume are permitted. Extra/init/ephemeral containers, overrides, tokens, Secret/PVC/host mounts and host namespaces are rejected. Updates may change metadata only when the workload specification is unchanged, allowing cleanup across runner-image upgrades. Runtime annotations are forbidden; Pod updates permit only three generated Calico annotations. Namespace quota permits two Jobs and two active Pods. The `backend` service account in `executor-app` may create/read/delete execution Jobs and read Pod status/logs; it cannot create Pods/configmaps, read Secrets, patch Jobs or add ephemeral containers. Dedicated admission-test roles are temporary and removed by the test.

Runner quality checks are scoped to its directory:

```sh
cd runner
uv run pytest src/app
uv run ruff check src
uv run ruff format --check src
uv run mypy src
uv run deptry src
```

The chat application is not implemented yet. API-server, metadata, external-IP, IPv6 and explicit DNS routing probes remain unverified by the three-route runtime gate. To remove only the owned cluster, retain the same explicit context and kubeconfig:

```sh
DOCKER_CONTEXT="$GVISOR_DOCKER_CONTEXT" kind delete cluster \
  --name "$GVISOR_CLUSTER_NAME" --kubeconfig "$GVISOR_KUBECONFIG"
```
