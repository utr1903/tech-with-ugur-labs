# A self-hosted coding agent: Qwen Code with Superpowers on one AWS GPU VM

This lab rents one GPU VM, serves an open-weight coding model on it with
vLLM, and points the [Qwen Code](https://github.com/QwenLM/qwen-code) CLI
plus the [Superpowers](https://github.com/obra/superpowers) skills extension
at it. You hand the agent a task file, watch it work in a live,
Claude-Code-like terminal view, and then an independent verifier — one that
never saw the agent's work while it happened — decides whether it actually
succeeded.

No Anthropic, OpenAI or any other hosted model API is involved anywhere. The
model, the agent runtime and the skills framework are all open source, and
everything runs on hardware you rent by the hour.

**Contents**

1. [What this lab shows](#1-what-this-lab-shows)
2. [What it costs](#2-what-it-costs)
3. [Architecture](#3-architecture)
4. [Prerequisites](#4-prerequisites)
5. [Quick start](#5-quick-start)
6. [How SSH works here](#6-how-ssh-works-here)
7. [Watching the agent](#7-watching-the-agent)
8. [Your own tasks](#8-your-own-tasks)
9. [What the verifier checks](#9-what-the-verifier-checks)
10. [Running the whole Superpowers flow unattended](#10-running-the-whole-superpowers-flow-unattended)
11. [What happened when I ran it](#11-what-happened-when-i-ran-it)
12. [Superpowers under Qwen Code](#12-superpowers-under-qwen-code)
13. [Settings you can change](#13-settings-you-can-change)
14. [Containment](#14-containment)
15. [Clean up](#15-clean-up)
16. [Troubleshooting](#16-troubleshooting)
17. Appendix — implementer internals:
    [Terraform file map](#17-terraform-file-map) ·
    [The tools app](#18-the-tools-app) ·
    [Versions](#19-versions)

## 1. What this lab shows

Superpowers is a skills framework written for Claude Code and frontier
models. I wanted to know: does it still do anything useful on top of a
much smaller open-weight coding model, running unattended with nobody
around to answer its questions? And separately: once an agent claims it's
done, how do you actually know?

So the lab draws a hard line between two things that are easy to conflate:

- **"The agent says it is done."** Its own last message, ending (if the run
  went well) with `ALL TASKS COMPLETE`.
- **"Independent tests pass."** A verifier that mounts a *clean copy* of the
  agent's workspace, runs `npm ci`, a type check, the agent's own tests, and
  a set of hidden acceptance tests the agent never saw, in a container with
  no memory of the run.

Only the second one decides pass or fail. The first is just a claim, and the
lab treats it as such.

On top of that hard verdict, the verifier also reports **measured, not
graded** process evidence read straight out of the transcript: which
Superpowers skills loaded, whether a test was written before the code it
covers, whether the agent ran its own tests and the program before
declaring victory, and how far the scripted Superpowers workflow itself got
(spec written? plan written? how many rounds?). None of that fails a run by
itself — it's there so you can judge whether the workflow actually steered
the model, not just whether the final code happens to work.

## 2. What it costs

The default instance is `g7e.2xlarge` in `eu-central-1`: one NVIDIA RTX PRO
6000 Blackwell (96 GiB), 8 vCPUs, 64 GiB RAM, 1.9 TB local NVMe.

| Instance | Price (eu-central-1, AWS price list published 2026-09-25) | GPU |
| --- | --- | --- |
| `g7e.2xlarge` (default) | USD 5.72 / hour | RTX PRO 6000 Blackwell, 96 GiB |
| `g6e.2xlarge` (fallback) | USD 2.80 / hour | L40S, 44.7 GiB |

You're billed for every hour the VM exists, whether or not you're actively
running a task. **There is no automatic shutdown.** When you're done, run
`make destroy`.

Cold start — from `make cloud-up` to a model that answers — took about
13 minutes end to end on the default pair, timed on a live deploy: most of
that is Terraform, the Instance Connect Endpoint, and downloading 80 GB of
model weights from Hugging Face onto the VM's local NVMe before vLLM loads
them into GPU memory. Your first run will vary with capacity and network
conditions; every run after the first is faster, because the weights stay
cached on the VM's NVMe until you destroy it.

## 3. Architecture

```
Laptop                               AWS eu-central-1, dedicated VPC
──────                               ───────────────────────────────────────────
make / terraform / aws cli           public subnet (one zone, variable)
        │                            ┌────────────────────────────────────────┐
        │  AWS API (reader's login)  │  Instance Connect Endpoint             │
        ├───────────────────────────▶│    SG: egress 22 → VM SG only          │
        │  tunnel                    │            │                           │
        │                            │            ▼ port 22                   │
        │                            │  GPU VM (no role, no key pair)         │
        │                            │    SG: ingress 22 from endpoint SG     │
        │                            │    Docker Compose project:             │
        │                            │      vllm      model + egress nets     │
        │                            │      coder     model + egress nets     │
        │                            │      verifier  egress net only         │
        │                            │      viewer    no network              │
        │                            └────────────────────────────────────────┘
```

The VM itself never gets an IAM role, a stored key pair, or any inbound
security-group rule from the internet. Your laptop talks to AWS's own API
(which you're already authorised for) and AWS relays an SSH tunnel to the
VM on your behalf — see [section 6](#6-how-ssh-works-here). Inside the VM,
one Compose project separates the always-on model server from the
per-run agent container, the verifier, and the transcript viewer, each on
only the network it needs.

## 4. Prerequisites

On your laptop:

| Tool | Notes |
| --- | --- |
| Terraform | exactly `1.16.3` |
| AWS CLI | v2 (needed for `ec2-instance-connect open-tunnel`) |
| `ssh`, `ssh-keygen`, `rsync`, `curl` | standard laptop tools |
| GNU Make | runs every command in this README |
| Docker | optional — only for `make test`, `make selftest`, `make replay-local` |

Run `make doctor` and it checks all of the above, plus your AWS login and
quota (below). `aws login` needs to have been run first, with an identity
that has the permissions listed here.

**GPU quota.** Your account needs at least 8 vCPUs of "Running On-Demand G
and VT instances" quota in the Region you use. Check it:

```bash
aws service-quotas get-service-quota --region eu-central-1 \
  --service-code ec2 --quota-code L-DB2E81BA --query 'Quota.Value'
```

If it's below 8, request an increase in the Service Quotas console (search
for "Running On-Demand G and VT instances" in your Region) — approval is
usually quick but isn't instant, so do this before you plan to run the lab.

**IAM permissions.** The identity you `aws login` with needs:

- EC2: create, describe and delete a VPC, subnet, internet gateway, route
  table, security groups, an EC2 Instance Connect Endpoint, and the
  instance itself.
- `ec2-instance-connect:OpenTunnel` and `ec2-instance-connect:SendSSHPublicKey`
  (how `make ssh`, `make run` and everything else reach the VM — see
  section 6).
- `ec2:GetConsoleOutput` (bootstrap reads the VM's SSH host key from it).
- `servicequotas:GetServiceQuota` (used by `make doctor`).
- `iam:CreateServiceLinkedRole` — only needed the first time your account
  ever creates an EC2 Instance Connect Endpoint.

## 5. Quick start

```bash
make doctor
make cloud-plan
make cloud-up
make run TASK=log-summary
make verify
make destroy
```

**`make doctor`** checks your laptop before anything is deployed:

```
  ok    terraform found
  ok    aws found
  ok    ssh found
  ok    ssh-keygen found
  ok    rsync found
  ok    curl found
  ok    Terraform 1.16.3
  ok    AWS CLI v2
  ok    AWS login is valid
  ok    G and VT on-demand quota in eu-central-1: 8 vCPUs
```

**`make cloud-plan`** runs `terraform plan` so you can see what will be
created before anything is billed.

**`make cloud-up`** applies it: creates the VPC, subnet, Instance Connect
Endpoint and VM, waits for the boot script, pins the VM's SSH host key,
pushes `vm/` and `tasks/` over the tunnel, builds the images and starts
vLLM — then blocks until the model actually answers a request. You can also
run `make model-check` any time afterwards to see the same proof again:

```
  ok    model qwen3-coder-next is served
  ok    tool call parsed: get_weather {'city': 'Berlin'}
  info  512 tokens in 3.2 s = 162 tokens/s (single request)
  info  GPU NVIDIA RTX PRO 6000 Blackwell Server Edition, 87443 MiB, 97887 MiB
```

**`make run TASK=log-summary`** starts the sample task and attaches the
live view — see [section 7](#7-watching-the-agent) for what that looks like.

**`make verify`** grades the run that just finished — see
[section 9](#9-what-the-verifier-checks).

**`make destroy`** tears everything down and confirms nothing was left
behind — see [section 15](#15-clean-up).

## 6. How SSH works here

There is no open inbound port on the VM, and no SSH key is ever written to
your laptop's `~/.ssh`. Every connection — `make ssh`, `make run`, `make
verify`, the rsyncs during bootstrap, all of it — goes through
`scripts/vm_ssh.sh`, the only place in the lab that knows how to reach the
VM. Each call:

1. Generates a throwaway ed25519 key pair in a temp directory.
2. Pushes the public half with `aws ec2-instance-connect send-ssh-public-key`,
   which authorises it for exactly 60 seconds.
3. Connects with `ssh`, using
   `aws ec2-instance-connect open-tunnel --instance-id ...` as the
   `ProxyCommand` — this is the tunnel AWS relays for you, authorised by
   your own `aws login` session, not by a security-group rule.
4. Deletes the temp directory (and the key with it) on exit.

**Host-key pinning.** `scripts/bootstrap_vm.sh` reads the VM's own SSH host
key straight out of its EC2 console output (the DLAMI prints it there on
boot) and writes it to a lab-local, gitignored `.ssh/known_hosts` before the
first connection, so every later connection is checked with
`StrictHostKeyChecking=yes` against a key nothing in transit could have
tampered with. If the console output ever doesn't show a key, bootstrap
falls back to accepting the key on the first connection through the
authenticated tunnel instead of failing outright.

**The one-hour limit.** An EC2 Instance Connect tunnel lasts at most one
hour before it's closed. That's fine for `make ssh` (reconnect and you're
back), but it would kill a long agent run mid-way if the agent ran inside
that SSH session. It doesn't: `make run` starts the agent as a detached,
`setsid nohup`'d process on the VM and returns a run id immediately, then
attaches a *separate* SSH session just to watch it. If your connection
drops — SSH timeout, laptop sleeps, `aws login` expiring — the run keeps
going on the VM; `make watch` just reattaches. I tested this by killing
the SSH connection mid-run: `make status` still reported it running, and
`make watch` reattached to the live view without losing anything.

## 7. Watching the agent

`make run TASK=<name>` starts a task and immediately attaches the live
view. Under the hood this is `vm/bin/watch.sh`, which runs the `viewer`
service (built from `vm/tools/`) against the run's `transcript.jsonl` as
the agent appends to it — a small TypeScript renderer that turns the
stream-json Qwen Code emits into something that reads like a coding
terminal: assistant text as it's produced, each tool call as a labelled
block (file writes and edits as coloured diffs, shell commands with their
output), skill loads highlighted, and a footer with turn count and elapsed
time.

If your connection drops, `make watch [RUN=<id>]` reattaches to the same
live view; `make status [RUN=<id>]` gives you the state and exit code
without attaching anything; `make logs [RUN=<id>]` follows the agent's raw
stderr if you want the unrendered detail.

All of the above is for *watching* the unattended, driven flow from
[section 10](#10-running-the-whole-superpowers-flow-unattended) — you
never type anything into it. `make shell` is the other mode: it opens an
interactive Qwen Code session in a `tmux` window on the VM, you at the
keyboard, answering its questions yourself as they come up. There's no
autonomy contract and no resume driver in that path — it's the same
image and the same model, just without the part of this lab that makes
a session finish itself.

Once a run has finished, `make replay [RUN=<id>] [DELAY_MS=15]` re-renders
its saved transcript on the VM, paced by `DELAY_MS` per line so it reads at
a followable speed instead of dumping the whole thing at once. To replay on
your own laptop instead: `make fetch-results [RUN=<id>]` copies the run
folder down to `./results/`, then `make replay-local RUN=<id>` runs the
same renderer locally in Docker, no VM connection needed.

This is what that rendering looks like — a real excerpt from the first
driven run of `log-summary` (`make replay-local` with `NO_COLOR=1`; the
`…` lines mark where turns were cut for length, not part of the render
itself):

```
Qwen Code 0.24.6 · qwen3-coder-next · /workspace
28 tools available

── turn 1/200 ──
⏺ I'll start by reading the TASK.md file to confirm the requirements, then use the brainstorming skill before implementing this CLI tool.


● Read(TASK.md)

── turn 2/200 ──
★ Skill(superpowers:brainstorming)
  ⎿ skill loaded
…
── turn 11/200 ──
⏺ Now let me create the parser module:


● Write(src/parser.ts)
  + import { ParsedLine } from './types.js';
  +
  + const LOG_PATTERN =
  +   /^(\S+)\s+(\S+)\s+(\S+)\s+\[([^\]]*)\]\s+"(\S+)\s+(\S+)\s+(\S+)"\s+(\d{3})\s+(\d+|-)\s+(\d+(?:\.\d+)?)\s*$/;
  +
  + export function parseLine(line: string): ParsedLine | null {
  +   const match = line.match(LOG_PATTERN);
  +   if (!match) {
  +     return null;
  … 36 more lines

── turn 18/200 ──


● Write(src/cli.test.ts)
  + import { describe, it, expect, vi, beforeEach } from 'vitest';
  + import { readFileSync } from 'fs';
  +
  + // Mock fs module
  + vi.mock('fs', async () => ({
  +   readFileSync: vi.fn(),
  + }));
  +
  + describe('CLI', () => {
  +   beforeEach(() => {
  +     vi.resetAllMocks();
  +   });
  +
  +   it('should handle missing file', async () => {
  … 1 more lines

…

● Shell(npm test)
  │ > access-log-summary@1.0.0 test
  │ > vitest run
  │
  │
  │  RUN  v5.0.2 /workspace
  │
  │  ✓ src/cli.test.ts (1 test) 3ms
  │  ✓ src/parser.test.ts (11 tests) 5ms
  │  ✓ src/summarizer.test.ts (5 tests) 11ms
  │
  │  Test Files  3 passed (3)
  │       Tests  17 passed (17)

…
▶ owner (scripted, round 2, spec): No human is available. Accept your recommended option for every open question and approach, write the spec now under docs/superpowers/specs/, then continue with the plan.
── session resumed ──

── turn 43/200 ──
● Write(docs/superpowers/specs/2026-09-28-access-log-cli-design.md)
  + # Access Log Summary CLI - Design Specification
  +
  + ## Project Overview
  +
  + A command-line tool that reads web-server access logs and outputs a JSON summary to stdout.
  +
  + ## Requirements
  +
  … 47 more lines

…
● Shell(npm test && npm run typecheck && echo "ALL TASKS COMPLETE")
  │ > access-log-summary@1.0.0 test
  │ > vitest run
  │
  │
  │  RUN  v5.0.2 /workspace
  │
  │  ✓ src/cli.test.ts (1 test) 4ms
  │  ✓ src/parser.test.ts (11 tests) 5ms
  │  ✓ src/summarizer.test.ts (5 tests) 12ms
  │
  │  Test Files  3 passed (3)
  │       Tests  17 passed (17)

── turn 47/200 ──
⏺ ALL TASKS COMPLETE
driver: complete after 2 rounds
✔ Finished: 47 turns, 45 tool calls, 1m39s
Agent exited 0
```

The finish line's counts are always for the *whole* run, not just the
round that happened to finish it: 47 turns matches the same run's
turn-by-turn tally in [section 11](#11-what-happened-when-i-ran-it), and
1m39s is round 1's 84s plus round 2's 15s added together, not either one
alone.

## 8. Your own tasks

A task is just a folder:

```
tasks/<name>/
  task.md             the only thing the agent's workspace starts with
  acceptance/         optional; never mounted into the agent's own container
    verify.json          { "runCommand": [...], "programPattern": "..." }
    fixtures/*.log        one input file per fixture
    expected/*.json       the fixture's expected output, matched by name
    *.test.ts             hidden tests, run with `node --test`
```

`task.md` is copied into the run's `workspace/` as `TASK.md` — that's the
entire prompt the agent gets. Nothing else in `tasks/<name>/` reaches the
agent's container; `acceptance/` is mounted into the *verifier* only, after
the run, against a clean copy of the workspace.

A task doesn't need an `acceptance/` folder to run — without one, the
verifier just reports that no hidden tests exist and grades only the hard
checks that don't need them (agent exit, install, type check, the agent's
own tests).

If you add hidden tests, they run with `node --test` in the clean workspace
copy, with `TASK_WORKDIR` set to that copy's path — see
`tasks/log-summary/acceptance/acceptance.test.ts` for a working example
that spawns the built CLI with `npm run --silent summarize --` against
temp files it writes itself.

A couple of things worth building into every task you write, because
`log-summary`'s does:

- **State plainly that no human is available.** Say so in `task.md` itself,
  and tell the agent to write down any assumption it has to make (a
  committed `ASSUMPTIONS.md` in the workspace, say) rather than stall
  waiting for an answer that will never come.
- **Give exact commands, not descriptions.** "Run `npm run --silent
  summarize -- <path>`", not "run the summarizer". The agent and the
  verifier both need to agree on exactly what gets run — `verify.json`'s
  `runCommand` and `task.md`'s stated command should match.

## 9. What the verifier checks

`make verify [RUN=<id>]` runs `vm/bin/verify.sh`, which mounts the run's
workspace and the task's `acceptance/` folder read-only, copies the
workspace into scratch space (so nothing the verifier touches can taint the
run itself), and prints a verdict.

**Hard checks** — any one failing fails the whole run:

| Check | What it runs |
| --- | --- |
| `agent-exit` | the agent process exited 0 (see the exit codes in [section 12](#12-superpowers-under-qwen-code)) |
| `install` | `npm ci --no-audit --no-fund` in the clean workspace copy |
| `typecheck` | the workspace's own `npm run typecheck` |
| `own-tests` | the workspace's own `npm test` |
| `acceptance` | the task's hidden `*.test.ts` files, via `node --test` |
| `fixtures` | each `acceptance/fixtures/*` run through the task's `runCommand`, output compared byte-for-byte (as JSON) against `acceptance/expected/*.json` |

A failed `install` skips every check after it — there's no point
type-checking or testing a project that doesn't install. A task with no
`acceptance/` folder reports `acceptance` and `fixtures` as skipped, not
failed.

**Measured process evidence** — reported for you to read, never graded:

- **Skills loaded**: every `skill(...)` tool call in the transcript, by
  name.
- **Test before code**: whether the transcript's first write to a
  `*.test.*` file has an earlier tool-call order than its first write to a
  non-test source file.
- **Ran tests / ran program**: whether a `run_shell_command` call matching
  the task's test command (or its `programPattern` from `verify.json`)
  appears anywhere in the transcript.
- **Checked after last change**: whether the *last* source-file write in
  the transcript is followed by a test or program run, rather than the
  agent stopping right after editing code.
- The full flow-driver picture from [section 10](#10-running-the-whole-superpowers-flow-unattended):
  rounds, replies per stage, whether a spec and a plan were written, how
  many subagent (`agent` tool) calls happened, and why the driver stopped.

Here's the real verdict for the same run as above (`make verify` with
`LOG_LEVEL=warn`, so only this summary prints):

```
VERDICT: PASS

  pass     agent-exit
  pass     install
  pass     typecheck
  pass     own-tests
  pass     acceptance
  pass     fixtures

Process evidence (measured, not graded)
  skills loaded: superpowers:brainstorming
  test before code: no
  ran tests: yes
  ran program: yes
  checked after last change: yes
  turns: 47
  tool calls: edit:2, glob:5, list_directory:2, read_file:3, run_shell_command:17, skill:1, write_file:15
  rounds: 2
  replies: spec:1
  spec written: yes
  plan written: yes
  subagent calls: 0
  finish reason: complete
```

## 10. Running the whole Superpowers flow unattended

Superpowers is designed around brainstorming with a human: it asks
clarifying questions, proposes a spec, and waits for you to approve each
step before moving on. That's a problem for a headless run with no human
attached — in an early trial run, the agent hit brainstorming's approval
gate and the session just ended there with nothing built. The exact
question it asked, and the run's numbers, are in
[section 11](#11-what-happened-when-i-ran-it).

**The contract.** Every agent session gets one extra system-message block,
on top of today's date, appended via `--append-system-prompt`
(`vm/coder/contract.md`):

```
You are running unattended. No human will read or answer your messages until the task is finished.
Follow the Superpowers workflow, and wherever a skill asks a human for input or approval, decide yourself:
1. In brainstorming, accept your own recommended option for every question and every choice of approach, and continue.
2. When brainstorming is complete, write the spec immediately and save it under docs/superpowers/specs/.
3. When the spec is written, write the implementation plan immediately and save it under docs/superpowers/plans/.
4. When the plan is written, execute it immediately with superpowers:subagent-driven-development, until every task in the plan is complete and verified.
When everything is done and verified, end your final message with the line: ALL TASKS COMPLETE
```

That's enough for a well-behaved session to talk itself past every gate in
one sitting. It isn't always enough: `--max-session-turns` or
`--max-wall-time` can still end a Qwen Code session (with a non-zero exit
and no final `result` line at all) before the agent gets anywhere near
`ALL TASKS COMPLETE`. That's what the driver is for.

**The driver.** `vm/coder/drive-agent.sh` is the container's entrypoint. It
runs `qwen -p "<task>"` for round 1, and whenever a round's session ends
before the agent has actually reported completion, it resumes the *same*
session (`qwen --continue -p "<one scripted line>"`) rather than starting
over. The one line it sends is picked from what the workspace already
contains — the same logic a patient owner would apply, always answering
"yes, go on":

| Workspace has | Reply |
| --- | --- |
| no `docs/superpowers/specs/*.md` | accept your recommendations and write the spec now |
| a spec but no `docs/superpowers/plans/*.md` | the spec is approved, write the plan now |
| a plan, but implementation hasn't been told to start yet | the plan is approved, execute it with `superpowers:subagent-driven-development` now |
| all of the above | keep going until every task is complete and verified, then end with `ALL TASKS COMPLETE` |

Whether a round is "actually done" is decided by looking at *only that
round's own last `result` line* in its stream-json output — never by
grepping the whole transcript for the string `ALL TASKS COMPLETE`. That
string can show up for reasons that have nothing to do with the task being
finished (a todo item that mentions it, the agent's own assistant text
promising to write it later, a file whose content happens to contain it).
The driver requires the round's last `result` event to have `is_error:
false` and its `result` text, trimmed, to literally end with that line —
and if a round produced no `result` line at all (the turn cap or the
wall-time budget cut it off mid-stream), that round is not complete either,
no matter what appeared earlier in the transcript.

Each scripted reply the driver sends is written into the transcript as its
own `driver` event, and the driver's own outcome gets one too, once it
gives up or the agent completes. Here are both lines, verbatim, from a
real driven run:

```
{"type":"driver","event":"reply","round":2,"stage":"spec","message":"No human is available. Accept your recommended option for every open question and approach, write the spec now under docs/superpowers/specs/, then continue with the plan."}
{"type":"driver","event":"finished","reason":"complete","rounds":2,"exitCode":0}
```

The viewer and verifier both parse these the same way anything else in the
transcript is parsed, so the live view renders the reply exactly like a
message from a human would, followed by the resumed session, and later the
driver's own summary line:

```
▶ owner (scripted, round 2, spec): No human is available. Accept your recommended option for every open question and approach, write the spec now under docs/superpowers/specs/, then continue with the plan.
── session resumed ──
…
driver: complete after 2 rounds
```

**Budgets and exit codes.** Three env vars control the driver, all
settable per run (see [section 13](#13-settings-you-can-change)):

| Variable | Default | Applies to |
| --- | --- | --- |
| `TURNS` | 200 | per round (Qwen Code's own `--max-session-turns`) |
| `WALL_TIME` | `90m` | one global budget shared across every round of the run |
| `ROUNDS` | 8 | the whole run — the driver gives up after this many rounds |

The driver's own exit code tells you which budget (if any) ran out:

| Exit code | Meaning |
| --- | --- |
| `0` | the agent reported completion and the driver confirmed it |
| the agent's own code (e.g. `53` turn limit, `55` wall-time or tool-call limit) | a round itself failed or was cut off, and the driver gave up rather than resume a dead session |
| `56` | the round cap (`ROUNDS`) was reached without the agent ever completing |

`agent-exit` in the verdict fails on any non-zero exit, `56` included — a
run that never finishes the workflow is not a pass, even if the code it did
write happens to work.

## 11. What happened when I ran it

Three real runs of the sample `log-summary` task, in order:

**Single-shot, no driver.** The earliest trial mentioned above: 3 turns,
7 seconds, exit 0 — and nothing built. The agent classified the task,
asked clarifying questions, proposed three architectures, and ended its
final message with: "Please confirm or suggest an alternative before I
proceed with the implementation plan." With no driver to answer it, the
session just stopped there. This is exactly the gap the driver in
[section 10](#10-running-the-whole-superpowers-flow-unattended) exists to
close.

**Driven run 1.** 2 rounds, one scripted reply (at the spec stage, shown
above), 47 turns, 102 seconds, exit 0, verifier `PASS` 6/6. Only
`superpowers:brainstorming` shows up in "skills loaded" — once the driver
told it the spec was wanted, it wrote the spec and the plan itself without
separately invoking `writing-plans`.

**Driven run 2.** 1 round, no scripted reply needed at all — the agent
talked itself past every gate and reached `ALL TASKS COMPLETE`
unattended. 96 turns, 242 seconds, exit 0, verifier `PASS` 6/6. Skills
loaded: `brainstorming`, `writing-plans`, `subagent-driven-development`,
`executing-plans`, `test-driven-development`. The interesting bit is
`subagent-driven-development`: it tried to hand work off to a background
subagent and got told "No ordinary background subagents are available in
this session," so it fell back to `executing-plans` instead — and picked
up `test-driven-development` on its own along the way.

**Test before code: no, both times.** Even in run 2, with
`test-driven-development` loaded, the transcript's own measured signal
says the test files landed after the source files they exercise, not
before. Loading a skill isn't the same as the model actually following it
turn by turn — that's the whole reason this measured section exists
separately from the pass/fail verdict.

**Timing.** `make cloud-up` to a model that answers took about 13 minutes
on a fresh apply. The runs themselves were fast: 102 seconds and 242
seconds. How often a run reaches `PASS` over more attempts than these
three is the kind of number that needs a real sample size to mean
anything — see the post for that.

## 12. Superpowers under Qwen Code

Two things had to line up for Superpowers to reach the model at all under
Qwen Code, and they're both worth knowing if you ever poke at the image.

**Where the bootstrap actually comes from.** Installing Superpowers from a
local clone (rather than Qwen Code's own `--ref` install, which downloads a
release tarball and records no commit) gives you the extension exactly as
it ships: a Qwen-format extension whose manifest names `GEMINI.md` as its
*context file*. Qwen Code loads every installed extension's context file
into the model's context at the start of every session, unconditionally —
and `GEMINI.md` is what imports `skills/using-superpowers/SKILL.md` and a
Claude-to-Qwen tool-name table. That's the one path the bootstrap needs:
plain context, loaded natively, no hook involved.

**Why `CLAUDE_PLUGIN_ROOT` is not exported here, on purpose.** Superpowers
also ships a `SessionStart` hook — the mechanism Claude Code itself would
normally use to inject this same bootstrap. Qwen Code substitutes
`${CLAUDE_PLUGIN_ROOT}` into that hook's command line if you ask it to, but
it never exports the variable itself. Left alone, the hook still runs, but
without `CLAUDE_PLUGIN_ROOT` in its environment it prints a bare
`additionalContext` field at the top level of its JSON output — a shape
Qwen Code's hook handler doesn't recognise, so it's silently ignored.
Export `CLAUDE_PLUGIN_ROOT` yourself and the hook's output changes shape to
`hookSpecificOutput.additionalContext`, which Qwen Code *does* apply —
and now the model gets the exact same bootstrap content twice in its
context: once from `GEMINI.md`, once from the hook. So the image doesn't
export it. The hook stays inert, `GEMINI.md` is the only path the bootstrap
travels, and `vm/coder/check-extension.sh` asserts at build time that this
is still true — that the installed extension's context file is still named
`GEMINI.md` and that file still imports the using-superpowers skill.

**The pinned-commit install.** `vm/coder/Dockerfile` clones
`https://github.com/obra/superpowers.git` at tag `v6.4.2` into
`/opt/superpowers`, then runs
`qwen extensions install /opt/superpowers:superpowers --consent` — a local
path, not a ref, so the extension's own install metadata records
`"type": "local"` and the actual commit is knowable. `check-extension.sh`
then fails the build outright if that clone isn't sitting on exactly
`8ca22dba9a94f28898bbce59f2537ff4d87c747d`, so the pinned version can never
silently drift.

## 13. Settings you can change

**`terraform/terraform.tfvars`** (copy from `terraform.tfvars.example`,
which is optional — every variable has a working default):

| Variable | Default | Change it for |
| --- | --- | --- |
| `availability_zone` | `eu-central-1a` | try `eu-central-1b` if you hit `InsufficientInstanceCapacity` |
| `instance_type` | `g7e.2xlarge` | the fallback pair, or a different size entirely |
| `model_id` / `model_revision` | `Qwen/Qwen3-Coder-Next-FP8` at a pinned commit | a different model |
| `served_model_name` | `qwen3-coder-next` | the name the agent addresses the model by |
| `max_model_len` | `262144` | context length in tokens |
| `gpu_memory_utilization` | `0.90` | the share of GPU memory vLLM reserves; `0.95` is reported to run out of memory |
| `max_num_seqs` | `16` | how many sequences vLLM decodes at once — see the note in `terraform/01_variables.tf`; Qwen3-Coder-Next's linear-attention layers cap this well below vLLM's default of `1024` regardless of GPU memory |
| `vllm_extra_args` | empty | extra flags passed straight to `vllm serve`; the fallback model needs some (below) |

Changing any of these and re-running `make cloud-up` re-triggers bootstrap
(rebuild, restart vLLM) without replacing the VM, so the weights you
already downloaded stay cached — unless the change is to `instance_type`
or `availability_zone`, which does replace the VM.

**Per-run budgets**, on the `make run` command line:

```bash
make run TASK=log-summary TURNS=300 WALL_TIME=2h ROUNDS=12
```

See [section 10](#10-running-the-whole-superpowers-flow-unattended) for
what each one bounds. `make replay` and `make fetch-results` also take
`DELAY_MS` (default `15`), the per-line pacing of a replayed transcript.

**The fallback pair.** `terraform.tfvars.example` has the L40S pair
commented out:

```hcl
instance_type          = "g6e.2xlarge"
model_id               = "Qwen/Qwen3.5-35B-A3B-FP8"
model_revision         = "9d1823d2dee688a6b25e77009dc727688c44936e"
served_model_name      = "qwen3.5-35b-a3b"
max_model_len          = 65536
vllm_extra_args        = "--language-model-only --reasoning-parser qwen3 --default-chat-template-kwargs {\"enable_thinking\":false}"
```

Uncommenting these alone is not enough. `vm/coder/settings.json` hardcodes
the model id the agent addresses (`qwen3-coder-next`) and its context
window (`262144`) for the default pair — nothing derives these from
Terraform automatically. Switching to the fallback means editing
`vm/coder/settings.json` too: change `modelProviders.openai[0].id` and
`model.name` to `qwen3.5-35b-a3b`, and `generationConfig.contextWindowSize`
to `65536`, before `make cloud-up` builds the `coder` image.

## 14. Containment

The `coder` container is the sandbox the agent runs in, and it's built to
hold nothing worth stealing and reach nothing worth reaching:

- Read-only root filesystem; only `/workspace` (the run's own files) and
  small `tmpfs` mounts for Qwen Code's and npm's scratch space are
  writable.
- All Linux capabilities dropped, `no-new-privileges`, non-root (`node`)
  user, memory and process limits.
- No Docker socket, no AWS credentials of any kind, no SSH material.
- Two Docker networks only: `model` (talks to `vllm`, nothing else) and
  `egress` (talks out to the internet, for `npm install`).
- Instance metadata (`169.254.169.254`) is unreachable — checked, not
  assumed.

**The trade-off.** Outbound internet stays open on `egress`, because the
agent needs to run `npm install` for whatever project it's building — a
task without arbitrary package installs would be a much narrower kind of
coding agent. That means a compromised or badly steered agent *can* still
exfiltrate data or fetch arbitrary code over that network, same as running
`npm install` on your own laptop can. What this containment buys you is
narrower: no path to your AWS account, no path to the Docker host, no path
to a stored credential. It does not buy you a fully airtight sandbox.

`make containment-check` proves the promises above, from both sides: from
your laptop, that the model's port and SSH are unreachable on the VM's
public address; from inside the container, that instance metadata is
unreachable, there are no `AWS_*` variables, no `~/.aws`, no Docker socket,
the process isn't root, and the root filesystem really is read-only.

## 15. Clean up

```bash
make destroy
```

runs `terraform destroy` and then `scripts/check_leftovers.sh`, which
searches the Region for anything still tagged with this lab's name —
instances, EBS volumes, Instance Connect Endpoints, security groups, VPCs,
elastic IPs — and fails loudly if it finds any. It prints `gone` for each
category that's clear (or `LEFT` with the surviving IDs if not), and a
clean destroy ends with one final `Nothing left behind.` line.

Run folders under `results/` on your laptop (from `make fetch-results`) are
gitignored and untouched by `make destroy` — they're local files, not AWS
resources, so delete them yourself if you want them gone.

## 16. Troubleshooting

| Symptom | What's going on | Fix |
| --- | --- | --- |
| `InsufficientInstanceCapacity` on `make cloud-up` | AWS is out of `g7e.2xlarge` capacity in that zone right now | set `availability_zone = "eu-central-1b"` in `terraform.tfvars` and retry |
| `make doctor` reports the G/VT quota is below 8 | your account's on-demand GPU quota is too low | request an increase for "Running On-Demand G and VT instances" in the Service Quotas console (see [section 4](#4-prerequisites)) |
| vLLM fails to start with a memory error | the model plus KV cache don't fit in the GPU's memory at the current settings | lower `gpu_memory_utilization` or `max_model_len` in `terraform.tfvars` and re-run `make cloud-up` |
| `aws login` session expires mid-run | your laptop's session timed out, but the run itself lives on the VM, not on your laptop's SSH session | run `aws login` again, then `make watch` to reattach — the run kept going the whole time |
| SSH host-key warning after replacing the VM | a new VM has a new host key, and your lab-local `known_hosts` still has the old one | nothing to do by hand — `scripts/bootstrap_vm.sh` rewrites `.ssh/known_hosts` from the new console output on the next `make cloud-up` |

---

## Appendix: implementer internals

Everything above is enough to run the lab. What follows is for anyone
digging into how the lab itself is built — the Terraform layout, the
tools app's internals, and the pinned versions — not needed to deploy or
run a task.

## 17. Terraform file map

Following the repo-wide `terraform-structure` convention, with two stated
exceptions:

| File | Content |
| --- | --- |
| `00_main.tf` | required Terraform and provider versions, default tags |
| `01_variables.tf` | every variable in [section 13](#13-settings-you-can-change) |
| `02_locals.tf` | tags, and the hash of every file pushed to the VM (so a change to `vm/` or `tasks/` re-triggers bootstrap) |
| `03_data.tf` | the AMI, looked up by its exact pinned name and owner |
| `04_network.tf` | VPC, public subnet, internet gateway, route table, both security groups |
| `05_access.tf` | the EC2 Instance Connect Endpoint |
| `06_vm.tf` | the instance itself, hardening (IMDSv2, encrypted root volume), its outputs |
| `07_bootstrap.tf` | the `local-exec` that runs `scripts/bootstrap_vm.sh` after the VM exists |
| `tests/security.tftest.hcl` | plan-only `terraform test` assertions of the security properties this README promises (IMDSv2 required, SSH reachable only through the endpoint, and so on) — runs with a mocked AWS provider, no credentials or cost, via `make tf-test` |
| `vm/host/boot.sh` | the VM's `user_data` (cloud-init) script — kept under `vm/` rather than `terraform/` and read into Terraform with `file()`, because it's really part of the VM image's own setup (moving Docker's data root and the model cache onto the local NVMe, checking the AMI has what the lab needs), not infrastructure description. It also moves containerd's own root: this AMI ships Docker 29, which stores images through containerd rather than Docker's classic graphdriver, so containerd's `/var/lib/containerd` needs the same NVMe move as Docker's data-root, or images still land on the 100 GB root volume. Skipping it is how an earlier version of this lab found the root volume at 84% full — moved before the boot completes, not after. |

## 18. The tools app

`vm/tools/` is one small TypeScript app (Node 22, strict types) that serves
both roles you've seen throughout this README: the `viewer` (live view and
`replay`) and the `verifier` (`verify`) are the same Docker image,
dispatched by its first argument. They share the same transcript parser —
there's no reason to maintain two, since both are ultimately reading the
same stream-json format, just for different purposes (render it, or grade
it).

One deviation worth knowing if you read the source: every log line the app
emits is structured JSON on **stderr**, never stdout — because stdout is
reserved for the thing a human actually asked for, either the rendered
live/replayed transcript or the verification summary. Logging to stdout
would mean those two things could get JSON log lines interleaved into
them; keeping logs strictly on stderr means you can always redirect stdout
alone and get exactly the rendered view or the summary, nothing else.

## 19. Versions

| Component | Version |
| --- | --- |
| Terraform | `1.16.3` |
| `hashicorp/aws` provider | `6.66.0` |
| AMI | Deep Learning Base OSS Nvidia Driver GPU AMI (Ubuntu 24.04) 20260925, owner `898082745236` |
| vLLM | `vllm/vllm-openai:v0.30.0@sha256:8a69ffad015f138d7170c4ddc429e230a3bc1c1719f67e14324749df200a4b90` |
| Node base image (every Node image in the lab) | `node:22.23.3-bookworm-slim@sha256:43ac6c60b8f89723f746e8a92ce91abd5017e627ce1ddfe4238355d3a30b772c` |
| Model (default) | `Qwen/Qwen3-Coder-Next-FP8`, revision `da6e2ed27304dd39abadd9c82ef50e8de67bdd4c`, served as `qwen3-coder-next` |
| Model (fallback) | `Qwen/Qwen3.5-35B-A3B-FP8`, revision `9d1823d2dee688a6b25e77009dc727688c44936e`, served as `qwen3.5-35b-a3b` |
| Qwen Code | `@qwen-code/qwen-code` `0.24.6` |
| Superpowers | tag `v6.4.2`, commit `8ca22dba9a94f28898bbce59f2537ff4d87c747d` |
| Tools app — runtime | `pino` `10.3.1`, `diff` `9.0.0`, `tsx` `4.23.15` |
| Tools app — dev | `typescript` `5.9.3`, `vitest` `5.0.2`, `@biomejs/biome` `2.5.14`, `knip` `6.38.0`, `@types/node` `22.20.4` |

Every version above is pinned exactly — no ranges, no floating tags —
including the container images, which are pinned by digest as well as tag.
