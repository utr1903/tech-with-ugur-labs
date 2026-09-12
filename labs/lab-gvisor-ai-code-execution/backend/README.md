# Durable Python executor

This directory contains the execution and database layer. `Executor.execute`
implements `ExecutePython`; it also accepts an optional `AbortSignal` as its second
argument. The HTTP/chat service wires this layer to server-owned thread, turn and
tool-call IDs.

Use `createPool(connectionString)`, then `setupDatabase(pool)`. Construct
`Kubernetes(inClusterConfig())` in the deployed backend. Host tools must use
`ownedConfig(absolutePath, context)`; no default kubeconfig is loaded. The backend
service account only creates/reads/deletes Jobs and reads Pods/logs in `executor`.
Tests impersonate that same service account from the explicit owned configuration.

The Job builder reads the public `../runtime/runner-job.json`, including its pinned
runner image. Deployment packaging must retain that file at the same relative
location. Source is the only variable container input. Changing that fixed template
changes its digest and deliberately rejects old execution replays.

## Persistence and recovery

A unique `(threadId, turnId, toolCallId)` transaction allocates a random execution ID
once, checks the UTF-8 source/template digests, and reserves at most two global slots
and one slot per thread. Capacity rejection is a durable terminal result for that
same tuple. Submission intent is committed before the sole create attempt.

Ownership uses a 12-second PostgreSQL lease and monotonically increasing fence.
An expired owner cannot renew or write a result, UID, submission state or capacity
release. A new owner reconciles the existing registered Job; lease expiry itself
never frees a slot. Acknowledged Job UIDs and observed Pod UIDs survive restarts.

Run `reconcileOutstanding()` at startup and periodically with an overlap guard.
A temporarily unavailable API or still-valid old lease can require a later pass.
Persisted terminal results precede foreground Job deletion with a UID precondition.
Capacity remains occupied until the Job is absent and all matching Pods are
terminal or absent. Cancellation follows the same persistence/cleanup rules.

If submission may have happened but no Job was ever observed, recovery stores an
**indeterminate failure** and never reruns the source. Its slot stays quarantined:
an earlier request might still create that Job. A later matching Job can be
reconciled and removed safely. Two unresolved quarantines intentionally stop new
admission. If neither Job can ever be observed, reset the disposable lab only after
stopping all backend workers and tearing down its cluster; never erase the ledger
while old workers or requests could create Jobs. This is conservative recovery,
not an exactly-once guarantee for arbitrary side effects across node failures.

## Bounds and status

Kubernetes requests have a two-second total deadline. The source budget is 16 KiB;
execution observations enforce a ten-second running deadline and a thirty-second
registration/scheduling deadline. The fixed Job independently enforces twenty
seconds with no retries. Network/API latency and termination grace can delay cleanup;
an occupied slot continues to cover that work. The runner's inner watchdog is
advisory, not the backend's status authority.

Only actual `OOMKilled`, Job `DeadlineExceeded`, or the backend's own elapsed
deadline yield resource statuses. A source-selected exit 124 or 137 is an ordinary
failure. Printed status and capture attribution are untrusted.

Log retrieval reserves its entire 32 KiB budget durably before one non-following
read. Polls and restarts cannot reset it. Both the HTTP reader and parser clamp
bytes; chunks are limited to 1024 decoded bytes, and stdout/stderr to 8192 raw bytes
each followed by an independent UTF-8 text-byte clamp. Complete earlier chunks
survive malformed frames and partial transport reads. Missing final capture makes
an otherwise successful container a capture failure. A crash during log retrieval
can lose diagnostics; recovery reports incomplete capture rather than rereading.
`runnerReportedTruncation` is advisory; the two stream truncation flags describe
backend-observed bounds/incomplete retrieval. PostgreSQL `json` retains escaped
NUL output; `jsonb` cannot represent it. Structured error logs omit original error
payloads because database/API errors can embed submitted source or output.

## Checks

Use Node 22 and run `npm ci`, `npm test`, `npm run typecheck`, `npm run lint`, and
`npm run knip`. Dependencies are pinned in the lockfile.

Unit tests run without services. Integration tests additionally require
`TEST_DATABASE_URL`, `LAB_KUBECONFIG` (absolute), and `LAB_KUBE_CONTEXT` for a disposable
owned PostgreSQL database and a verified gVisor cluster with the executor policy
installed. **Integration tests reset the `executions` table in that test database.**
They never use `DATABASE_URL`. Use a separate test database; the runtime tests create
only execution Jobs through the backend identity. Do not run suites concurrently
against the same fixture. The PostgreSQL disconnection test terminates only its
own randomly identified executor connection.

Tests cover normal/flood/binary output, deliberate exit codes, actual OOM and both
external deadlines, killed/stopped supervisors, source/template and UID conflicts,
unknown create responses, crash/replay gaps, lost log reads, cancellation, expired
live owners and delayed deletion. No ordinary-runtime fallback is available.

## Persistent chat API

`npm run start` runs Hono on `127.0.0.1:3001`. It accepts only localhost Host and
Origin values. This is an unauthenticated, single-owner laptop application; a
thread ID is not a multi-user authorization mechanism. The cluster backend listens
inside its Pod; Services are ClusterIP-only. Host port forwards must explicitly
use `--address 127.0.0.1` and the owned kubeconfig and context.

- `POST /threads` creates a server-owned UUID; `GET /threads` returns up to 100.
- `GET /threads/:id/messages` returns `{messages, activeTurn}`. User and assistant
  entries contain `{id, role, text}`. Tool entries have role `tool` and JSON text
  containing the bounded `ExecutionResult`; decode it and render fields as text.
- `POST /threads/:id/chat` accepts `{turnId, messages: [{id, role:"user", text}]}`.
  IDs are stable client IDs of 1–80 ASCII letters, digits, underscores or hyphens.
  Send new input or repeated user history plus its new suffix. Changed replay
  content, duplicate IDs and reordered history are rejected. Never send assistant
  or tool messages as user input.
- SSE `event: chat` carries JSON `assistant`, `tool-start`, `tool-result`, `done`
  and `error` events, each with a stable monotonically increasing `sequence` and
  SSE `id`. `Last-Event-ID` resumes after a sequence. Repeating the original turn
  request rejoins active work or replays the persisted result without a new Job.
- `GET /health` checks database connectivity.

LangGraph uses its actual PostgreSQL checkpointer with synchronous durability.
Canonical bounded model actions are committed before model-node return and keyed
by `(threadId, turnId, modelStep)`. Server-generated message/tool IDs preserve
identity through checkpoint gaps; client turn IDs reused in another thread have
separate actions. Tool events preserve escaped NUL bytes using PostgreSQL `json`.

A dedicated PostgreSQL connection holds a nonblocking thread advisory lock for
the whole turn. At most four turns run globally, with two tools per turn. Model
calls have a 120-second deadline and turns a 300-second deadline plus bounded
execution cleanup. Recovery cannot steal a live owner's lock or free its durable
slot merely because its deadline expired. A browser disconnect only ends its
subscription; the bounded turn continues and can be rejoined after a reload.

Requests are capped at 128 KiB, 64 user messages, and 16 KiB per user message.
Each thread accepts at most 64 user messages. Each process admits 32 HTTP requests
and 16 SSE subscriptions; slow readers have a five-second write deadline and an
aggregate 256 KiB event budget. Queries, pool acquisition, model HTTP responses,
model actions and output are independently bounded. Execution reconciliation runs
at startup and every five seconds without overlapping itself.

## OpenAI configuration and verification

`MODEL_MODE=scripted` needs no provider key and replaces only model responses with
real `AIMessage.tool_calls`; graph/checkpoints/executor/Jobs are unchanged. Set
`SCRIPTED_SCENARIO=tool` for a calculation, `conversation` for no tool, `repeat`
for the two-tool limit, or `stall` for deadline checks. `SCRIPTED_SOURCE` supplies
an optional bounded test program. Never put real credentials in a test program.

For your own live check, configure `MODEL_MODE=openai`, `OPENAI_MODEL` (default
`gpt-4.1-mini`), and `OPENAI_API_KEY` in the backend process environment. The app
does not load environment files automatically. The default model supports
[function calling](https://developers.openai.com/api/docs/models/gpt-4.1-mini).
Requests use the OpenAI Responses API, strict `code_executor` arguments, no
parallel tools, no SDK retries, no response storage, and at most 2048 output tokens.
Your conversation and bounded tool results are sent to OpenAI in this mode.

In Kubernetes, create your own Secret named `chat-openai` in `executor-app`, with
an `api-key` field, through your normal credential tooling. Then set the app chart's
`modelMode=openai`, `openaiSecret=chat-openai`, and optionally `openaiModel`.
Only the backend receives this Secret as an environment variable. The frontend,
execution Jobs, source, logs and stored conversation never receive the key.
The chart does not create or embed an API-key Secret.

After starting your backend in OpenAI mode, run `npm run smoke:live` with
`BACKEND_URL` set to its localhost URL. This requests a real provider tool call
and checks a successful Python result and final turn. It uses your OpenAI account.
**Live OpenAI verification has not been run.** Keyless tests verify the provider's
HTTP request/response contract against a local fixture with fake credentials;
scripted integration tests exercise real LangGraph, PostgreSQL and gVisor Jobs.

## Building the backend image

`npm run build:image` uses only this backend directory as the Docker build context.
It stages the public sibling runner template byte-for-byte into ignored `.build/`,
then copies it to `/app/runtime/runner-job.json`; application files live under
`/app/backend`. The helper verifies the staged SHA-256 and removes staging after a
build. Set `LAB_DOCKER_CONTEXT` and `BACKEND_IMAGE` for your owned Docker environment.
The Node and PostgreSQL base images are digest-pinned. Load the built image into
your owned cluster and configure `backendImage` with its verified OCI digest.
When importing locally built images, ensure containerd has the full digest-named
reference as well as the build tag. PostgreSQL data uses a PVC; the executor chart
owns the application namespace and backend service account, so install it first.
