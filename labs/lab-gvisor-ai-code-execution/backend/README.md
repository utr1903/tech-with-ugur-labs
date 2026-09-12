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
