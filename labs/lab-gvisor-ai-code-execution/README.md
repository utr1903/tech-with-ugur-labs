# Verify Python execution with gVisor on Kubernetes

This runtime prototype launches a fixed Python Job through gVisor and checks its live runtime identity. A byte-recording canary tests pod-IP, service-IP and node-port routes, including positive reachability controls and an independent Calico default-deny check.

The execution Job runs as a non-root user with a read-only root filesystem, dropped capabilities, no service-account token and no mounted data. The runsc handler uses `systrap` with `network=none`. The runtime test temporarily removes the configured handler, proves Python cannot start, restores it and reruns the calculation.

Prerequisites: a Linux x86_64 Docker host, kind `v0.32.0`, kubectl `v1.33.1`, Bash, Python 3.12, curl, bzip2 and sha256sum. The bootstrap creates only the named `gvisor-code-execution` cluster and refuses to overwrite an existing cluster. It pins Kubernetes `v1.33.1`, Calico `v3.31.3`, Python `3.12.12-slim-bookworm` and gVisor `release-20260907.0` using verified manifest digests or archive checksums. Kubernetes 1.33.1 is a feasibility compatibility candidate; current security support has not been assessed for this prototype.

From this directory, run:

```sh
bash runtime/bootstrap.sh
bash runtime/runtime-smoke.sh
bash runtime/network-smoke.sh
```

Tests write machine-readable results and raw runtime/policy/canary evidence beneath `/tmp/gvisor-runtime-smoke` and `/tmp/gvisor-network-smoke`. Successful tests remove their Jobs and canary namespaces. A failed test preserves resources for inspection; the handler drill has an exit trap that restores the original configuration.

To remove this cluster:

```sh
kind delete cluster --name gvisor-code-execution
```

The verified host path uses Ubuntu 24.04.5 with Docker 29.1.3 in a full-system x86_64 QEMU TCG guest on an ARM64 Mac. Its Linux kernel reports x86_64, while the CPU is emulated. Native macOS Docker Desktop ARM64 gVisor operation remains unverified.

This prototype covers runtime identity, configured-handler failure and the three controlled TCP routing paths. API-server, DNS, metadata, external-IP and IPv6 routes, process/resource bounds, admission, backend RBAC and the chat application remain unverified. The runtime, CNI, Kubernetes administrator and host remain trusted components.
