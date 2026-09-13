# Local application workflow

Requires Node 22/npm, Python 3.12/uv, kind v0.32.0, kubectl, Helm,
Docker with a Linux daemon, jq, curl, bzip2, sha256sum and OpenSSL.
The ARM64 path runs genuine gVisor systrap in Docker Desktop's Linux VM.
Linux x86-64 Ubuntu VM testing established runtime feasibility only; sustained
full application verification on x86-64 has not been performed.

Run commands from the lab directory. Choose a dedicated absolute state directory
outside the checkout. Bootstrap refuses an existing cluster; it never switches
your global Kubernetes context. It downloads checksummed runtime/CNI artifacts,
builds only each public app directory, loads digest-addressed images, installs
fixed executor admission, and deploys PostgreSQL, backend and frontend through Helm.

```sh
export GVISOR_DOCKER_CONTEXT=desktop-linux  # use your Linux Docker context
export DOCKER_CONTEXT="$GVISOR_DOCKER_CONTEXT"
export GVISOR_CLUSTER_NAME="gvisor-ai-code-execution-$(date +%s)-$$"
export GVISOR_STATE_DIR="$(mktemp -d /tmp/gvisor-ai-code-execution.XXXXXX)"
export GVISOR_KUBECONFIG="$GVISOR_STATE_DIR/cache/kubeconfig"
npm run bootstrap -- --scripted
npm run e2e
npm run connect
```

Open http://127.0.0.1:3000. Keep `connect` running; Ctrl-C stops only its two
localhost port forwards. Stop `connect` before e2e, which owns the same local ports.
The app is unauthenticated, single-owner localhost software; thread UUIDs do not
provide multi-user authorization. Never expose the services or forwards publicly.

The keyless flag replaces only model responses. Real Hono, LangGraph, PostgreSQL,
Kubernetes, gVisor and browser execution remain active. E2e temporarily uses
scripted model responses, performs controlled runtime/network/resource drills,
restores the backend to scripted calculation mode and records a JSON assertion
report in the private state directory. It never requests a provider key. Reports
contain submitted test programs, nonce packets, Pod details and local paths; do
not publish them unreviewed. A required unavailable route exits nonzero and is
reported unverified. IPv4-only cluster configuration does not imply IPv6 sockets
or loopback are disabled. Controlled metadata/external routes are disposable
listeners inside the owned kind node; they are not real cloud metadata services.

For the hidden-prompt key injection and complete workflow, see the root README.
For OpenAI mode, make `OPENAI_API_KEY` available in the bootstrap process's
environment through your own secret manager, then run `npm run bootstrap` without
`--scripted` on a new named cluster/state directory. Bootstrap creates a backend-only
Kubernetes Secret. `openaiModel` defaults to `gpt-4.1-mini` and is configurable in
chart values. The frontend, Python Jobs and persisted conversations never receive
the key. After connecting, run:

```sh
npm run smoke:openai
```

That command requires a real provider-selected `code_executor` call producing 42.
Live OpenAI verification needs your key and incurs provider usage; it was not run
for the keyless verification report.

```sh
npm run teardown
```

Teardown validates the named kind node label and removes only that named cluster.
It leaves local state/evidence for review, including any generated database material
and kubeconfig. Remove your selected state directory when no longer needed. No
Docker prune, unrelated cluster deletion or global kubeconfig edit occurs.

The TypeScript e2e application owns its pinned Node tooling and colocated tests.
Its generated Python snippets are fixed test payloads and a disposable node listener,
not another installed Python service. The listener records only probe nonce packets;
its process, files and individually commented NAT rules are removed after the drill.
The runner and source share a UID and are treated as one untrusted unit. Inner
runner wall-clock signals are advisory; authoritative OOM/deadline labels require
Kubernetes reasons. Deliberate exit 124 or 137 is tested separately.

PostgreSQL enables TCP keepalive probes (5-second idle, 2-second interval,
3 probes, 10-second user timeout). This lets it detect a backend Pod whose network
and process disappeared, releasing that dead connection's advisory lock. A paused
process with a responding TCP kernel retains its connection and ownership; lease
expiry is not a takeover signal. The crash drill proves the old container and PID
stopped before claiming recovery. This is not a test of every network partition.

The context probe remembers a fresh random token through the real graph, proves
the backend process stopped, then asks a follow-up without repeating that token.
Its scripted adapter derives the answer only from prior model-input messages; a
separate thread must return no token. Output probes count raw capture bytes before
the verifier's defensive display clamp and require a complete capture summary.
A cleanup failure cannot skip restoring the owned runtime handler: all restoration
steps are attempted and any errors are reported together.
