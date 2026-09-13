# Kubernetes Job isolation for unsafe shell execution

This lab deliberately runs the shell command supplied to `POST /execute`. Two Hono servers create real Kubernetes Jobs and collect their results through separate PVCs. The insecure worker can extract clearly synthetic PII and download a harmless local marker script. The secure worker runs the same commands and image with restricted identity, mounts and networking. Do not expose these unauthenticated endpoints beyond localhost.

## Prerequisites and startup

Tested on macOS arm64 with native Node **22.23.2**, npm **10.9.8**, Docker Desktop (Engine **28.3.2**) running Linux containers with **8 GiB** available, kind **0.32.0**, Helm **4.2.4** and kubectl **1.36.3**. Put Node 22 and the pinned kind/Helm/kubectl versions on `PATH`; bootstrap checks them and the Linux Docker daemon before changing the cluster. Ports **3000** and **3001** must be free. Node 22 from Homebrew can be selected with `export PATH="/opt/homebrew/opt/node@22/bin:$PATH"`. Other platforms have not been verified.

From this lab directory:

```sh
npm ci
npm run bootstrap
npm run e2e
```

Kubernetes Jobs, PVC subPaths and an enforcing CNI are the subject of this lab, so its entrypoint is `npm run bootstrap` rather than Docker Compose. Bootstrap creates only the named kind cluster `job-isolation`, using the digest-pinned Kubernetes **1.36.1** node image in `deploy/versions.json` with default CNI disabled. It installs Cilium **1.20.1**, waits for readiness, builds and loads the server/Ubuntu worker/fixture images, installs the two Helm releases, waits for private PII seeding, and starts owned port forwards bound to `127.0.0.1`.

Setup needs internet for pinned npm dependencies, Helm charts and image/build dependencies; the Ubuntu apt packages are repository-resolved during the build. After setup, runtime commands and the E2E use only the local cluster and local fixture. No cloud account, internet download, real PII or malware is required. Bootstrap can reuse its own cluster and refreshes server/fixture Pods after rebuilding; it refuses unrelated namespaces/clusters and never deletes an existing cluster to make setup succeed. All Kubernetes operations use the explicit `kind-job-isolation` context.

## Try both workers

```sh
curl -sS http://127.0.0.1:3000/execute \
  -H 'content-type: application/json' \
  -d '{"message":"printf '\''hello\\n'\''"}'
curl -sS http://127.0.0.1:3001/execute \
  -H 'content-type: application/json' \
  -d '{"message":"printf '\''hello\\n'\''"}'
```

Each returns a different generated UUID with the same result:

```json
{"id":"<generated-UUID>","exitCode":0,"output":"hello\n"}
```

A command such as `printf 'stderr\n' >&2; exit 7` returns HTTP 200 with `exitCode: 7` and the captured text. Malformed, empty and oversized input returns HTTP 400. Missing or invalid result files return generic HTTP 500. A Job or request deadline returns generic HTTP 504 and awaits deletion. There is exactly one application route; readiness uses TCP probes.

| Worker control | Insecure | Secure |
| --- | --- | --- |
| PVC mount | Whole release volume | Own server-selected `runs/<UUID>` subPath |
| Identity | Root | UID/GID 10001, non-root |
| Capabilities / escalation | Container defaults | Drop ALL / disabled |
| Root filesystem | Writable | Read-only; writable `/tmp` emptyDir, 64 MiB |
| Service-account token | Default mount | Automount disabled |
| Worker network | No isolation policy | Deny ingress and egress, including DNS |
| Seccomp | Runtime defaults | Explicit RuntimeDefault |

The root server seeds `/data/private/pii.json` with unique fake canaries (directory 0700, file 0600, owner 0:0). It creates fresh `runs/<UUID>` directories, owned by 10001 in secure mode. Both workers see `HOME=/home/runner` and write `~/data/<UUID>.md` plus a small JSON `<UUID>.exit` file. Insecure results appear at the PVC root; secure results appear inside their own subPath. Requests cannot choose a mount, execution ID, image, service account or security context. Both modes use identical server/worker images and never use privileged containers, host namespaces, direct hostPath mounts or engine sockets.

## Evidence and bounds

`npm run e2e` exits nonzero if any assertion fails and writes the machine-readable, gitignored `artifacts/e2e-report.json` with operation, expected outcome, actual status/output/exit and supporting live Job/pod identities/specifications. It checks exact stdout/stderr/exit7, operator-confirmed seeded canaries, retained prior results, traversal/symlink/FIFO/directory/metadata failures, benign recovery, local downloaded bytes and fixture request-count controls, independent DNS, token absence without recording token bytes, nonroot/capabilities/no-new-privileges and a write to runner-owned `$HOME/rootfs-probe` that must return EROFS. It also measures two-slot concurrency and executes enough real Jobs to prove the 128-result retention cap. The age limit is covered by unit tests and live Job TTL, without pretending to wait an hour.

Network evidence measures outbound paths to the local fixture by **DNS, Pod IP and Service IP**, with bounded curl requests and successful controls before/after denials. Independent bounded DNS avoids confusing failed resolution with IP-level blocking. These observations do not prove all internet/node-address paths or ingress isolation; NetworkPolicy has CNI and node-traffic limitations. Policy rendering alone is insufficient evidence.

Limits apply to both modes: **8 KiB request body**, **64 KiB combined captured stdout/stderr**, **30-second Job active deadline**, **two executions at once per release**, and CPU/memory/ephemeral-storage limits in the fixed template. The total request budget is **60 seconds: 55 seconds for queueing/scheduling/execution and 5 seconds reserved for awaited cleanup**. Capture truncation is explicit (`truncated: true`); it terminates the process group and bounds draining. Completed containers and deleted timed-out Jobs provide cleanup evidence. A Linux process that escapes the original process group relies on container termination for final cleanup. This is not protection against every denial of service or arbitrary attacker writes to writable storage.

Results are retained for up to **128 completed executions and one hour within a server lifespan**; pruning and the periodic sweep remove known results/Jobs. Job TTL also removes old completed Kubernetes resources. Bookkeeping is in memory: server restarts can leave old PVC output data outside that accounting until teardown. Arbitrary extra files created by commands are not covered by the captured-result cap. Each PVC is 1 GiB. The launcher and server reject replaced/nonregular result paths; real filesystem unit tests verify the server's bounded no-follow reader. A deployed launcher rejection alone does not prove reader behavior.

The attacker controls only command text. The server, cluster administrator, fixed Job template, container runtime, enforcement components, host and kernel are trusted. A compromised server that creates unrestricted Jobs, kernel exploits, and comprehensive resource-exhaustion defense are outside the boundary. Returned results are untrusted text. The lab has no authentication, frontend, admission framework or alternate sandbox runtime.

Operations log JSON through pino with IDs, categories and summaries. Commands, result text, synthetic PII and token bytes are excluded from app operation logs. Backend diagnostics retain safe category/code/syscall/HTTP status and bounded sanitized causes rather than raw exception messages/bodies/stacks, because client exceptions or JSON errors can echo submitted commands/results. HTTP error responses remain generic.

## Files, checks and teardown

`src/api` owns the single route, `src/execution` owns deadlines/slots/retention, `src/kubernetes` owns the fixed template/client, `src/storage` owns seeding and bounded reads, `worker` contains the Ubuntu launcher, `src/e2e` contains real-cluster probes, and `deploy` contains digest/version pins, kind/Helm/CNI/fixture configuration. `src/commands` orchestrates reader commands. `.runtime` holds owned forwarding records; `artifacts` holds local evidence.

```sh
npm test
npm run build
npm run lint
npm run knip
npm run test:fixture
npm run test:worker:container
npm run teardown
```

The optional worker test command runs all 13 launcher tests in the built Ubuntu worker image. Native `npm run test:worker` targets Linux and its `setsid` lifetime test is unavailable on macOS. Native app tests need no cluster; E2E and container worker tests require bootstrap first.

Teardown verifies and stops only its recorded port-forward processes and deletes only the named, positively identified `job-isolation` cluster, including its PVC data. It does not delete local Docker images, npm dependencies or the local report. Run teardown when finished or before a clean setup.
