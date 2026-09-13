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

## What runs and how it is built

| Component | Responsibility | Build |
| --- | --- | --- |
| Server (one per release) | Hono validates requests, chooses IDs and the fixed Job template, seeds private synthetic PII, manages execution slots/deadlines, reads results and prunes known completed executions. It mounts its release's whole PVC and has permission to create/delete Jobs. | The root `Dockerfile` compiles TypeScript in a pinned Node 22 build stage, then copies `dist` into the same pinned Node base with production npm dependencies. |
| Worker (one Pod per execution) | The dependency-free Node launcher runs the submitted shell command, captures bounded combined stdout/stderr, terminates the process group when needed, and writes output and exit metadata to the mounted result directory. | `worker/Dockerfile` uses pinned Ubuntu 24.04, installs curl/CA certificates/C++ runtime, copies Node from the pinned Node image and copies the launcher, configuration validator, result-file validator and JSON logging helper. Its runner user has UID 10001; the insecure Job overrides this to root. |
| Download fixture (local shared service) | Serves the fixed harmless `/marker.sh` bytes and logs request paths/sources so probes can distinguish reachability from a failed client. The probes download and inspect the script; they do not execute it. | `fixture/Dockerfile` copies the dependency-free HTTP server into the pinned Node image and runs it as the image's `node` user. |

Bootstrap builds all three images locally and loads them into kind. The insecure and secure releases use identical server and worker image bytes; their configured Job controls differ.

The **server** is the trusted controller, not the shell runner. Its long-lived Deployment uses the `server` service account, with namespace-scoped permission to create, observe and delete Jobs and observe Pods (`deploy/chart/templates/identity.yaml`). It runs as root so it can seed root-only private data and assign each secure run directory to UID/GID 10001. There is no server `fsGroup` that would make the private fixture group-readable. Each release has its own server and PVC; the comparison happens between workers inside those separate releases. `src/api/app.ts` handles input and HTTP responses, `src/execution/service.ts` coordinates admission and cleanup, and `src/kubernetes` builds and observes the Jobs.

The **worker** is short-lived: every admitted execution creates a new Job with one Pod and no retries. `configuration.mjs` validates the server-provided UUID, command and output budget; `launcher.mjs` starts `/bin/sh -c <message>` in a detached process group and drains both child pipes into one bounded capture. It cleans background descendants with TERM followed by KILL and validates the result paths through `result-files.mjs`. It flushes `<UUID>.md` before publishing `<UUID>.exit`, whose schema is `{"exitCode":7,"truncated":false}`. The launcher itself exits successfully when collection succeeds, even if the submitted command exits 7. This distinction lets the server return command failures as results and collection failures as HTTP errors. The Job template supplies the mode's mounts, identity and resource limits; the worker image itself is shared.

The **fixture** is a separate, long-lived Deployment and ClusterIP Service in `download-fixture`. Its Node HTTP handler serves only the exact fixed `GET /marker.sh` payload; other requests return 404. It does not execute the marker, accept uploads or expose a caller-selected file. The fixture runs without a service-account token, with a read-only root filesystem and dropped capabilities. Its request log gives the E2E an independent observation: a successful download must add one `/marker.sh` event, while a blocked secure request must add none. The suite obtains actual Pod/Service addresses from Kubernetes so direct-IP checks do not depend on DNS working.

A request flows from localhost through the owned port forward to its release's server. The server validates the JSON/body limit, waits for one of two slots, generates a UUID, prepares the result directory and creates a fixed Kubernetes Job containing the command in its execution configuration. Kubernetes starts the worker; the launcher invokes the shell and captures its streams into `<UUID>.md`, then writes `<UUID>.exit`. The server observes Job completion, reads both files through its bounded no-follow reader, and returns the UUID, exit code and captured text. A nonzero command exit is still a successful HTTP 200 response. Failed result validation or a deadline triggers awaited cleanup and a generic error response.

The PVC is the data boundary being compared. Insecure workers mount the whole release volume, including its private canary and retained results. Secure workers mount only the server-selected `runs/<UUID>` subPath at `/home/runner/data`; their temporary directory is a separate bounded emptyDir. The server still sees the whole PVC to seed and collect data. Worker network probes contact only the separate local fixture, by hostname, Service IP or Pod IP.

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

The table describes every probe case, including operator checks that inspect the cluster independently of worker output. “Both” means the same expected outcome for insecure and secure releases. Recovery checks run after input errors, result tampering, traversal, truncation, timeout, concurrency and retention pruning.

| E2E case | Purpose | Insecure expected outcome | Secure expected outcome |
| --- | --- | --- | --- |
| Baseline real execution | Establish a working command path in each release. | HTTP 200, exit 0, exact benign marker. | Same. |
| Operator identical live images | Compare actual worker/server image identities. | Same image references and nonempty image IDs as secure. | Same image bytes as insecure. |
| Service-account token availability | Check the mounted identity without returning JWT bytes. | Nonzero token byte count, exit 0. | Read fails, exact absence marker, exit 1; live automount disabled. |
| Identity, capabilities, no-new-privileges and rootfs | Compare runtime identity and a write to runner-owned HOME. | UID 0; HOME owned by 10001; write succeeds. | UID 10001; all five capability sets zero; NoNewPrivs 1; write fails with EROFS; live restrictions match. |
| Operator CNI and live worker policy | Establish ready enforcement components and worker selector. | Shared Cilium/nodes ready. | Live worker policy selects workers and has no ingress/egress allowances. |
| Operator worker labels, bounds and forbidden features | Inspect existing Job/Pod templates and server specs. | Worker labels, deadline/TTL, no retries or forbidden host features; server has no fsGroup. | Same. |
| Operator seeded private canary | Confirm the protected data actually exists. | Synthetic canary, root 0:0, directory 0700/file 0600. | Same, in its separate PVC. |
| Synthetic PII visibility | Search mounted data for the real seeded fixture. | Exact seeded canary returned after execution marker. | Only execution marker returned; no canary. |
| Create retained prior result | Create a unique marker before cross-Job reads. | Exact marker, HTTP 200/exit 0. | Same. |
| Operator retained prior result | Prove the earlier file is present before the probe. | Exact file still present. | Same. |
| Cross-Job known prior result | Try reading a known prior execution's result. | Exact prior marker exposed through whole PVC. | Nonzero exit, no prior marker. |
| Cross-Job subPath traversal | Try stepping above the worker mount to the prior UUID. | Nonzero exit, no marker at this particular path. | Nonzero exit, no marker. |
| Operator prior result after probes | Rule out removal of the target as the reason for denial. | Prior marker unchanged. | Same. |
| Path traversal to private canary | Try a mode-specific parent path into private data. | Whole-PVC traversal returns exact canary. | Nonzero exit, no canary. |
| Operator fixture addressing | Record ready fixture identity and actual addresses. | Shared fixture has Pod/Service IPs and no forbidden host features. | Same shared target. |
| DNS download positive before | Establish hostname-route reachability and bytes before secure probe. | Exact marker bytes on disk/output; fixture count increases by one. | Covered by the following denial. |
| DNS bounded download denial | Check secure hostname download with live positive controls. | Positive control before and after succeeds. | Nonzero curl exit, no downloaded file, unchanged fixture count. |
| DNS download positive after | Verify fixture remains reachable after denial. | Exact bytes; one additional fixture hit. | Uses insecure reachability control. |
| Service IP download positive before | Establish IP-route reachability independently of DNS. | Exact marker bytes; one additional fixture hit. | Covered by the following denial. |
| Service IP bounded download denial | Check direct Service IP egress with bounded curl. | Positive controls before/after succeed. | Curl exit 28, no file, unchanged fixture count. |
| Service IP download positive after | Rule out fixture failure during Service IP denial. | Exact bytes; one additional fixture hit. | Uses insecure reachability control. |
| Pod IP download positive before | Establish direct Pod IP reachability. | Exact marker bytes; one additional fixture hit. | Covered by the following denial. |
| Pod IP bounded download denial | Check direct Pod IP egress with bounded curl. | Positive controls before/after succeed. | Curl exit 28, no file, unchanged fixture count. |
| Pod IP download positive after | Rule out fixture failure during Pod IP denial. | Exact bytes; one additional fixture hit. | Uses insecure reachability control. |
| Independent bounded DNS resolution | Separate DNS failure from IP-level blocking. | getent resolves fixture Service IP, exit 0. | getent fails or times out within its four-second bound (exit 2/124). |
| Malformed JSON | Reject an incomplete JSON body. | HTTP 400, no Job. | Same. |
| Missing message | Reject an absent command field. | HTTP 400, no Job. | Same. |
| Empty message | Reject an empty command. | HTTP 400, no Job. | Same. |
| Wrong message type | Reject a numeric command field. | HTTP 400, no Job. | Same. |
| Oversized body | Enforce the 8 KiB input bound. | HTTP 400, no Job. | Same. |
| Stdout, stderr and user exit preservation | Preserve both streams and distinguish shell exit from backend error. | HTTP 200, exact stdout/stderr markers, exit 7. | Same. |
| Missing output | Delete the expected captured output path. | Generic HTTP 500; Job deleted; no canary. | Same. |
| Invalid metadata | Replace exit metadata with the wrong field type. | Generic HTTP 500; Job deleted; no canary. | Same. |
| Missing metadata | Terminate the launcher before metadata completion. | Generic HTTP 500; Job deleted; no canary. | Same. |
| Output symlink to private canary | Replace output with a sensitive-path symlink. | Generic HTTP 500; Job deleted; no canary. | Same. |
| Metadata symlink to private canary | Replace metadata with a sensitive-path symlink. | Generic HTTP 500; Job deleted; no canary. | Same. |
| Output FIFO | Replace output with a pipe rather than a regular file. | Generic HTTP 500; Job deleted; no canary. | Same. |
| Metadata FIFO | Replace metadata with a pipe. | Generic HTTP 500; Job deleted; no canary. | Same. |
| Output directory | Replace output with a directory. | Generic HTTP 500; Job deleted; no canary. | Same. |
| Metadata directory | Replace metadata with a directory. | Generic HTTP 500; Job deleted; no canary. | Same. |
| Bounded output and container cleanup | Run continuous output and inspect PVC sizes/termination. | Exactly 65536 captured bytes, explicit truncation, metadata ≤128 bytes, worker terminated. | Same. |
| Job deadline and awaited deletion | Run longer than the Job deadline and inspect independent cleanup. | Generic HTTP 504; Job, Pods and three known result/run paths absent; elapsed <65s tolerance. | Same. |
| Concurrent requests 0, 1 and 2 | Verify three distinct requests preserve their own results. | Each returns its exact marker, HTTP 200/exit 0. | Same. |
| Two-slot bounded concurrency | Sample active Jobs while three four-second commands run. | Maximum observed active Jobs exactly two; third completion ≥3s later than first. | Same. |
| Retention sentinel | Create a known older completed result. | Exact sentinel marker captured. | Same. |
| Actual server-lifetime retention cap | Execute 130 real filler Jobs and inspect files and Job identities. | All fillers succeed; latest 128 regular bounded results/Jobs retained; older sentinel file/Job deleted. | Same. |
| Operator all observed worker templates | Validate every captured worker identity/template, including retention fillers. | Resource requests/limits, 30s deadline, 3600s TTL, one Pod/no retries, no forbidden host features. | Same. |
| Operator worker runtime cleanup | Inspect running worker containers inside the kind node after all probes. | No running worker containers. | Same shared runtime check. |
| Benign recovery after each disruptive case | Verify later executions still work after each tested failure or bound. | HTTP 200, exit 0, exact recovery marker. | Same. |
| E2E infrastructure failure (conditional) | Record incomplete probes if infrastructure or transport throws. | Failing evidence row and nonzero E2E exit. | Same run-level failure handling. |

Network evidence measures outbound paths to the local fixture by **DNS, Pod IP and Service IP**, with bounded curl requests and successful controls before/after denials. Independent bounded DNS avoids confusing failed resolution with IP-level blocking. These observations do not prove all internet/node-address paths or ingress isolation; NetworkPolicy has CNI and node-traffic limitations. Policy rendering alone is insufficient evidence.

Limits apply to both modes: **8 KiB request body**, **64 KiB combined captured stdout/stderr**, **30-second Job active deadline**, **two executions at once per release**, and CPU/memory/ephemeral-storage limits in the fixed template. The total request budget is **60 seconds: 55 seconds for queueing/scheduling/execution and 5 seconds reserved for awaited cleanup**. Capture truncation is explicit (`truncated: true`); it terminates the process group and bounds draining. Completed containers and deleted timed-out Jobs provide cleanup evidence. A Linux process that escapes the original process group relies on container termination for final cleanup. This is not protection against every denial of service or arbitrary attacker writes to writable storage.

Results are retained for up to **128 completed executions and one hour within a server lifespan**; pruning and the periodic sweep remove known results/Jobs. Job TTL also removes old completed Kubernetes resources. Bookkeeping is in memory: server restarts can leave old PVC output data outside that accounting until teardown. Arbitrary extra files created by commands are not covered by the captured-result cap. Each PVC is 1 GiB. The launcher and server reject replaced/nonregular result paths; real filesystem unit tests verify the server's bounded no-follow reader. A deployed launcher rejection alone does not prove reader behavior.

The attacker controls only command text. The server, cluster administrator, fixed Job template, container runtime, enforcement components, host and kernel are trusted. A compromised server that creates unrestricted Jobs, kernel exploits, and comprehensive resource-exhaustion defense are outside the boundary. Returned results are untrusted text. The lab has no authentication, frontend, admission framework or alternate sandbox runtime.

Server and reader commands log structured JSON through pino. Operations emit an `info` start event and an `info` success event, or an `error` failure event. Submitted shell command text **is logged** in structured `args` alongside the executable `command`; process invocations also include executable, arguments and working directory (`cwd`). This helps trace which operation ran, but a secret literally embedded in submitted command text or arguments will therefore appear in logs. Captured command output, synthetic PII read from files and service-account token bytes are not copied into operation logs. The local E2E report intentionally retains test outputs and synthetic canaries as evidence.

`src/lib/operation.ts` implements the shared try/catch pattern: log input fields, await the operation, log its result summary, and log a sanitized error before propagating failure. Callers use this helper for request validation, slot acquisition, execution, storage reads and Job operations. A shell command appears as `"command":"/bin/sh","args":["-c","printf 'hello\\n'"]`; a setup command appears as `"command":"kubectl","args":["--context","kind-job-isolation","-n","secure","get","jobs","-o","json"]`. Arguments remain separate literal process arguments in setup code. Execution IDs, namespace/mode, deadlines, file paths, byte counts and exit codes connect the operation events without copying result contents.

Worker and fixture use lightweight dependency-free JSON logging. Worker lifecycle logs are separate from the command streams captured into result files, so logging does not change returned output. Fixture logs retain exactly one request event with `path` and source per request; listener lifecycle and request completion/failure events omit `path`, preserving the E2E's path-based request counts. Backend diagnostics retain safe category/code/syscall/HTTP status and bounded sanitized causes rather than raw exception messages/bodies/stacks, which can echo submitted commands or results. HTTP error responses remain generic.

## Files, checks and teardown

`src/api` owns the single route, `src/execution` owns deadlines/slots/retention, `src/kubernetes` owns the fixed template/client, `src/storage` owns seeding and bounded reads, `worker` contains the Ubuntu launcher, `configuration.mjs` input validation, `result-files.mjs` file validation and dependency-free `operations.mjs` logging helper, `src/e2e` contains real-cluster probes, and `deploy` contains digest/version pins, kind/Helm/CNI/fixture configuration. `src/commands` orchestrates reader commands. `.runtime` holds owned forwarding records; `artifacts` holds local evidence.

```sh
npm test
npm run build
npm run lint
npm run knip
npm run test:fixture
npm run test:worker:container
npm run teardown
```

The optional worker test command runs all 15 launcher tests in the built Ubuntu worker image. Native `npm run test:worker` targets Linux and its `setsid` lifetime test is unavailable on macOS. Native app tests need no cluster; E2E and container worker tests require bootstrap first.

Teardown verifies and stops only its recorded port-forward processes and deletes only the named, positively identified `job-isolation` cluster, including its PVC data. It does not delete local Docker images, npm dependencies or the local report. Run teardown when finished or before a clean setup.
