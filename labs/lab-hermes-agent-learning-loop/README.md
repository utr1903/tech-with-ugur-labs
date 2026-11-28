# Hermes Agent, part 1: does a self-improving agent get better at a job, and does splitting it across subagents help?

[Hermes Agent](https://github.com/NousResearch/hermes-agent) advertises three
ideas: a closed learning loop (the agent writes its own skills from experience
and reuses them), subagents (`delegate_task`) and programmatic tool calling
(`execute_code`, where the model writes a script instead of calling tools one
at a time). This lab measures all three on one synthetic job, a weekly
security triage of a small fleet, running Gemma 4 26B through Vertex AI.

The claim under test: after it has done the job once, an agent that keeps what
it learned (and has subagents plus a Python sandbox) finishes next week's
version faster and cheaper than one that starts cold, and the toolbox matters
independently of the memory. The lab reports the numbers either way. Nothing
is asserted about "warm beats cold"; only that the pipeline ran and the
reports are valid and accurate enough to compare.

## The job

Each week the agent gets a fleet directory with six services and a
`RUNBOOK.md`. For every service it must find:

- suspicious IPs in an nginx access log (at least 20 responses with status
  401 or 403, or any request for a probe path such as `/.env`),
- risky config flags in `config.yaml`,
- vulnerable dependencies in `requirements.lock`, checked against an offline
  advisory file,

and write a strict JSON report to `/out/<cell>/report.json`. The data is
generated with a fixed seed (`data/fleet/week-1`, `data/fleet/week-2`) with a
deterministic answer key (`data/answers/`), so scoring is plain precision,
recall and F1 over the findings. No LLM judge. The logs are large enough that
reading every file into the conversation is expensive, and small enough that
`grep` alone also works. The answer keys are never mounted into Hermes.

One known quirk: the report example in `RUNBOOK.md` lists `billing` with
`pyyaml` 5.3 and advisory `TWU-2026-0001`, and that dependency finding is true
in both weeks, so an agent that copies the example earns one true positive for
free. It is the same in every cell, so it does not favour any of them.

## The matrix

Two configurations times three situations gives six cells.

| Cell | Config | Week | Home | What it shows |
| --- | --- | --- | --- | --- |
| `full-cold` | full | 1 | fresh `full-learn` | First time on the job with subagents and the sandbox. The agent may write a skill afterwards. |
| `full-warm` | full | 2 | same `full-learn` | Same agent, new week, with whatever it learned. |
| `full-control` | full | 2 | fresh `full-control` | Week 2 with no prior learning: the fair comparison for `full-warm`. |
| `flat-cold` | flat | 1 | fresh `flat-learn` | First time with no subagents and no `execute_code`. |
| `flat-warm` | flat | 2 | same `flat-learn` | Flat agent, with what it learned. |
| `flat-control` | flat | 2 | fresh `flat-control` | Flat agent, week 2, cold. |

`hermes/full.yaml` and `hermes/flat.yaml` are identical except that `flat`
also lists `delegation` and `code_execution` under `agent.disabled_toolsets`,
so the comparison isolates those two tools. A "home" is one named Docker
volume (`twu-hermes-full-learn`, `twu-hermes-full-control`,
`twu-hermes-flat-learn`, `twu-hermes-flat-control`) holding everything Hermes
keeps: skills, memory, sessions and logs. The prompt is the same in every cell
and never mentions skills.

How learning is handled after a `*-cold` cell: the harness waits for Hermes'
background review to finish, then looks for newly written skills. If there are
none, it sends one follow-up in the same session ("Save the workflow you just
used for this weekly triage as a reusable skill ...") and records the learning
path as `unprompted`, `follow-up` or `none`, with the follow-up's tokens
counted separately.

Each cell starts with an empty `out/`, so no cell can read a report an earlier
cell left there. A run that passes its 30-minute deadline, or whose event
stream fails, is stopped through Hermes' API and recorded as an error, and the
matrix restarts Hermes on the same home before the next cell, so a stuck run
cannot keep writing into the next one.

## Architecture

```
 your laptop (Docker Compose)
+----------------------------------------------------------------------+
|                                                                      |
|  harness container                      hermes container             |
|  (Python, runs as HERMES_UID)           (image pinned by digest)     |
|  +---------------------+  POST /v1/runs +-----------------------+    |
|  | fixtures, run,      |--------------->| API server :8642      |    |
|  | check, report,      |<---- SSE ------| agent loop            |    |
|  | leak-check          |   events       |  delegate_task        |    |
|  +---------------------+                |  execute_code         |    |
|    |        |      |                    |  skill_manage         |    |
|    |        |      | reads (ro)         +-----------------------+    |
|    |        |      v                      |     |      |     |        |
|    |        |   hermes_home volume <------+     |      |     |        |
|    |        |   (skills, memory, logs)  /opt/data|   /fleet  /out      |
|    |        v                                    |   (ro)   (rw)       |
|    |     results/ (run.json, events, skills,     |    |      |        |
|    |     metrics.md)                    ADC file (ro)  |      |        |
|    v                                          |   data/fleet  out/    |
|  data/ (fixtures, answer keys)                |                       |
+-----------------------------------------------|-----------------------+
                                                v
                              Vertex AI: Gemma 4 26B (OpenAI-style API)
```

The harness talks only to Hermes' API server. It starts a run, streams the
events, collects child sessions for token counts, scores the report from
`out/`, and reads the Hermes home read-only to copy out the skills the agent
wrote. Hermes reaches only Vertex AI: the web, browser, vision, image,
speech, cron and connection toolsets are disabled.

## Prerequisites

- Docker with Compose v2 (Docker Desktop on macOS or Windows).
- `make`, `curl`, `openssl`; `shellcheck` only for `make test`.
- The Google Cloud CLI (`gcloud`), logged in, with a default project that has
  billing enabled: `gcloud auth login`, then `gcloud config set project <id>`.
- Application Default Credentials: `gcloud auth application-default login`.
  This lab uses your own user credentials; the file is mounted read-only into
  the Hermes container (see [Security](#security)).
- The Vertex AI API enabled in that project. `make vertex` enables it, which
  is free; you pay per token.
- Access to `google/gemma-4-26b-a4b-it-maas` in the `global` region.

The lab creates no cloud resources, so there is nothing to destroy afterwards.

### Cost and time

Gemma 4 26B on Vertex AI is billed per token (USD 0.15 per 1M input tokens,
USD 0.60 per 1M output tokens when this was written; check the current
price). Measured so far: a cold `full` cell takes 17 to 26 minutes and uses
1.4 to 2.3 M input tokens and 0.05 to 0.08 M output tokens, which is USD 0.24
to 0.39 per cell. Assuming the other five cells are about as expensive, one
pass over all six (`make run`, or `make e2e`) comes to roughly USD 1.4 to 2.3
and, because the cells run one after another, about 2 to 3 hours of wall time.
`REPEATS=3` triples both. The `est. USD` column in `results/metrics.md` is an
upper bound: it prices every input token at the full input rate and does not
split out cached input, which can be billed lower. The six-cell figures are
estimates and will be replaced by the measured totals of the committed run (see
[Results](#results)). Vertex streams occasionally stall for up to about
180 seconds with no data; Hermes detects that and retries, which shows up as
a slower cell, not a failed one.

## Run it

```bash
make env        # creates .env: your gcloud project, a fresh API key, your uid/gid
make vertex     # only if the Vertex AI API is not enabled yet
make doctor     # Docker, gcloud, ADC, the API, and one direct call to the model
make fixtures   # proves the committed data/ matches the generator (check only)
make e2e        # the full run and its assertions; REPEATS=3 make e2e repeats the matrix
make down       # stop everything and delete the four home volumes
```

`make e2e` runs, in order: `make fixtures`, `make run`, `make curator`,
`make report`, `make leak-check`, and the harness assertions. The pieces are
also available on their own:

| Target | Does |
| --- | --- |
| `make up` | Start Hermes on the `full-learn` home and check it end to end (health, version, configured model). Good for a first smoke test. |
| `make run` | The six-cell matrix on fresh homes (`REPEATS=N` repeats the block). |
| `make curator` | Asks Hermes' curator what it would do with each learn home's skills (dry run) and its status. Output goes to `results/curator/`. |
| `make report` | Rebuilds `results/metrics.md` from every `run.json`, offline. |
| `make leak-check` | Scans `results/` and `out/` for the API key, the GCP project id, ADC secrets and access tokens. |
| `make test` | Harness tests, lint and types in Docker, plus `shellcheck`. |
| `make help` | Lists the targets. |

`make report` averages every `run.json` under `results/runs/`, and new runs
are numbered after the ones already there. This repository ships its own run
in `results/runs/`, so move it aside first if you want your numbers on their
own: `mv results/runs results/runs-committed` (or `rm -rf results/runs`).

With `REPEATS` above 1, `metrics.md` averages only the runs that completed
with a valid report and lists the others, and the assertions check the latest
repeat of each cell, printing how every earlier repeat ended without failing
on it.

`make fixtures` only checks. The fixtures are generated from a fixed seed and
are committed. To regenerate them after changing the generator:

```bash
docker compose --profile tools run --rm --build --no-deps harness fixtures
```

## What you should see

`make doctor` prints one `ok` line per check. `make e2e` prints the harness'
structured JSON logs while each cell runs, then the assertions: fixtures match,
six cells completed with schema-valid reports, F1 of at least 0.8 for every
`full` cell, an agent-written skill after `full-cold` that `full-warm` loaded,
control homes that started with only the bundled skills, `delegate_task` and
`execute_code` used in `full` cells and absent in `flat` cells, the metrics
table written, curator dry runs exit 0, and no secrets in the output. Before
them it prints one `INFO earlier repeat` line per earlier repeat.

Files appear under `results/` (the committed run ships there, so you can read it
without running anything):

```
results/
  metrics.md                     the summary table (read this first)
  fixtures-check.txt             exit code of the fixture check
  curator/                       curator dry-run and status per learn home
  runs/<cell>/r<N>/
    run.json                     all metrics of one run
    events.jsonl                 the raw event stream
    report.json                  the agent's report
    skills/<name>/SKILL.md       skills the agent wrote in that run
    MEMORY.md                    its memory file, if any
```

### Reading `results/metrics.md`

- **Cost and tools**: one row per cell with the number of runs, `ok runs`
  (completed with a valid report, out of all runs), F1, parent and child
  tokens (children are the subagents), mean tool calls per run
  (`delegate_task`, `execute_code`, `skill_manage`, `skill_view`,
  `terminal`), wall seconds, the learning path of each run, `skill loaded`
  and `skill patched` (how many runs viewed or changed a skill that existed
  before the run, as `k/N`), the learning overhead tokens and the estimated
  cost, which is an upper bound. With `REPEATS` above 1 each number is the
  mean over the ok runs with its min to max range.
- **Precision, recall and F1 per finding category**: suspicious IPs, risky
  config and vulnerable dependencies, each with precision (`P`), recall (`R`)
  and F1, so you can see which rule an agent gets wrong.
- **Where it went wrong**: the missed and extra findings of each cell's latest
  run, then every run left out of the means, with its status and error.
- **What the agent wrote**: links to the copied `SKILL.md` and `MEMORY.md`.

Open the agent's own `SKILL.md` next to the table. It is the learning loop's
actual output: the workflow the agent decided was worth keeping. Compare it
with `full-warm`'s `events.jsonl` (look for `skill_view`) to see whether the
agent used it, and whether it patched it afterwards. The learning path varies
from run to run: sometimes the background review writes a skill without being
asked, sometimes only the follow-up turn does, and sometimes nothing is
written. That variation is part of the result, which is why the table records
the path.

## Results

The measured table of the committed run (and its `REPEATS=3` variant) appears
here. `results/metrics.md` is always the source of truth, and the six-cell
figures in the cost section above are estimates.

## Knobs that matter

All of them live in `hermes/full.yaml` and `hermes/flat.yaml`, which are
mounted read-only over Hermes' `config.yaml`:

| Setting | Why it matters |
| --- | --- |
| `skills.write_approval` | Hermes' setting for whether a skill write needs sign-off. Left at Hermes' default and not set in this lab's configs. |
| curator (`hermes curator`) | Reviews and consolidates agent-written skills over time. The lab only runs its dry run and status (`make curator`); a skill the agent writes in the foreground shows up as "unmanaged", not as a curator candidate. |
| `delegation.max_concurrent_children`, `delegation.model` | How many subagents run at once and which model they use. The lab leaves both at their defaults, so children use the same model as the parent. |
| `delegation.gateway_mode: inline` | Keeps subagents inside the API request. Without it the harness would have no way to follow them. |
| `approvals.mode: "off"` | No confirmation prompts, since nobody is there to answer them. **Quote it**: an unquoted `off` is the boolean `false` in YAML 1.1. |
| `auxiliary.title_generation.enabled: false` | Title generation otherwise goes to a different, faster model than the one you are testing. |
| `agent.disabled_toolsets` | What the agent may not use. `flat` adds `delegation` and `code_execution`. |

## Gotchas

- **Use a named volume for the Hermes home, not a bind mount.** On macOS a
  bind-mounted home breaks `execute_code` (it cannot `chmod` its RPC socket:
  `Errno 22`).
- **Do not set `GOOGLE_APPLICATION_CREDENTIALS` or `VERTEX_CREDENTIALS_PATH`.**
  Hermes treats them as service-account keys and fails on a user credential
  (`authorized_user`). The ADC file is mounted at Hermes' default path
  instead.
- **`/v1/models` lists only `hermes-agent`,** never the model behind it. The
  harness reads the `model` field of the session row (`/api/sessions`) to
  confirm Gemma is what answered.
- **Turn title generation off.** It routes to a different model and costs a
  call per session.
- **Writes are limited to `/opt/data`.** The image only lets the agent write
  under its home, so the first live run saved its report to
  `/opt/data/out/` where the harness could not see it. Compose sets
  `HERMES_WRITE_SAFE_ROOT=/opt/data:/out` so the report can land in `/out`.
- **`HERMES_UID`/`HERMES_GID`.** The image remaps its `hermes` user to these
  ids so files in `out/` belong to you. Its home is mode 700, so the harness
  runs as that same uid and gid to read the skills from the read-only mount.
  `make env` fills both in from `id -u` and `id -g`.
- **`make doctor` and `make leak-check` do not read `.env`.** They use the
  Makefile's `ADC_FILE` default, and `make doctor` takes the project from
  `VERTEX_PROJECT_ID` in your shell or, failing that, gcloud's default
  project. Set gcloud's default project to the one in `.env`, and if you point
  `.env` at another credentials file, pass the same one to make
  (`make doctor ADC_FILE=...`, `make leak-check ADC_FILE=...`).
- **One Compose project name per clone directory name.** Two clones with the
  same directory name share the Compose project and the four volumes. Run
  `make down` in one before using the other.
- **A harmless warning on start:** "config predates version 12" and a failed
  config migration on the read-only file. Hermes runs with the file as given.
- **Stalled streams.** Vertex streams can go quiet for up to about 180 seconds.
  Hermes kills and retries them; do not abort a run that looks stuck.

- **Spell out `delegate_task`'s arguments.** With only "give each service to
  its own subagent", Gemma 4 sometimes passed each task as a plain string
  ("Task 1 must be an object, got str.") or asked for 101 subagents at once
  (the cap is 10 at a time and 50 per turn). Hermes rejects the call, the
  model retries the same call until Hermes' loop guard ends the turn, and no
  report is written. That broke 3 of 9 `full` runs in a first `REPEATS=3`
  pass. The prompt's tool line now says to call `delegate_task` once with a
  list of objects, each with a `goal` and a `context`. The line is the same in
  every cell, and `flat` cells don't have the tool.

## Security

This setup is for learning, not for running on anything that matters.

- Approvals are off: the agent runs shell commands and Python without asking.
- The agent can read the mounted ADC file (Hermes needs it to call Vertex AI),
  and with it your gcloud user credentials. Use a scratch project, and prefer
  a throw-away Google account if you can.
- The container is the only boundary: the fleet data is mounted read-only,
  `out/` is the only writable host folder, memory, CPU and process limits are
  set, `no-new-privileges` is on, and all capabilities are dropped except the
  five the image's init needs (`CHOWN`, `SETUID`, `SETGID`, `DAC_OVERRIDE`,
  `FOWNER`; Hermes does not start without the first four). The API server
  listens on `127.0.0.1:8642` and requires the key from `.env`.
- Egress is not blocked: the container can still reach the internet even
  though the web toolsets are disabled. Part 2 of this series hardens that.
- `make leak-check` scans `results/` and `out/` for the API key, your GCP
  project id (`VERTEX_PROJECT_ID`), the ADC refresh token and client secret,
  and `ya29.` access tokens before you commit or share anything. It reports
  the file and the kind of hit, never the value.

## Pointing it at your own model server

To run the same matrix against a model you host (for example a Mac Studio
running vLLM or llama.cpp's server), replace the `model` line in both config
files with a custom OpenAI-compatible endpoint:

```yaml
model: {provider: custom, base_url: "http://host.docker.internal:8000/v1", default: <served model name>}
```

Serve it with a context window of at least 64000 tokens (set `context_length`
if the server does not report it); Hermes expects that much room for its tools
and a long session. Also set `HERMES_MODEL` in `.env` to the same name so
`make up` and the `check` step accept it.

Two things still expect Vertex AI. Compose requires `ADC_FILE` and bind-mounts
it, so point `ADC_FILE` in `.env` at any existing file (an empty JSON file
containing `{}` will do) and skip `make vertex` and `make doctor`, which probe
Vertex AI. `make leak-check` mounts the same file, so pass it there too.
A placeholder file holds no ADC secrets, and leak-check refuses to pass
without any, so tell it to skip them: set `LEAK_CHECK_ADC=off` in `.env`, or
run `make e2e LEAK_CHECK_ADC=off`. It logs a warning and still scans for the
API key, the project id and `ya29.` tokens. Leave it `on` (the default) for
Vertex AI runs.

On Docker Desktop `host.docker.internal` resolves out of the box. On Linux add
`extra_hosts: ["host.docker.internal:host-gateway"]` to the `hermes` service
in `compose.yaml`, or use the host's IP address in `base_url`. Everything else
is unchanged.

## Clean up

```bash
make down
```

This stops the containers and deletes the four home volumes. Nothing is left
running or billed. Delete `.env` yourself if you no longer need the API key
(`results/` and `out/` stay on disk).
