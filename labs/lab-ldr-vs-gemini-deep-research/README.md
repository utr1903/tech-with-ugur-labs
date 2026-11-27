# Is a home GPU box good enough for deep research? Local Deep Research vs Gemini Deep Research

Deep-research products promise a cited report on any question. This lab asks
how far you get with software you host yourself. It runs the open-source
[Local Deep Research](https://github.com/LearningCircuit/local-deep-research)
(LDR) 2.0.4 against an open-weight model (`Qwen/Qwen3.6-27B-FP8`, served by
vLLM) on a rented GPU VM that stands in for "a GPU box at home", and races it
against Gemini Deep Research. Both answer two questions whose answers come
from official APIs (CISA's Known Exploited Vulnerabilities feed and SEC
EDGAR), and a deterministic scorer, with no LLM judge, grades every run
against frozen answer keys.

The searches leave from your own IP (SearXNG on your laptop), and the model
port on the VM is never public: your laptop reaches it only through an SSH
tunnel.

> **Cost.** A `g7e.2xlarge` in eu-central-1 costs about **USD 5.72 per hour**
> while it exists, and the first start downloads about **29 GB** of model
> weights. Gemini Deep Research costs roughly **USD 1-3 per task**; Google's
> search-grounding charges beyond its free monthly allowance are not included
> in the cost column the scorer prints. `make down` destroys everything.

## Score the committed runs (no cloud, no keys)

The repository ships the raw outputs of the live run under `results/runs/`
for both tools, so you can score them first:

```bash
make env     # creates .env with generated secrets
make score   # prints the scoreboard and writes results/scoreboard.md
```

The Gemini runs under `results/runs/gemini` can be scored (and compared with
your own LDR runs) even if you never get a paid Gemini key. `make score`
touches neither the network nor Terraform.

## Prerequisites

- Docker Desktop (macOS or Windows) with Compose v2. See
  [Linux](#linux) if you are not on Docker Desktop.
- Terraform 1.16.3 (the lab pins it; `make doctor` checks).
- AWS CLI v2, logged in to an account that may create EC2 resources in
  eu-central-1, with at least **8 vCPUs of the "Running On-Demand G and VT
  instances" quota** (one `g7e.2xlarge`). New accounts often have 0; request
  an increase first.
- `make`, `ssh`, `rsync`, `curl`, `openssl`; `shellcheck` only for `make test`.
- A descriptive contact string for `SEC_USER_AGENT` in `.env` (SEC and CISA
  block anonymous clients), such as your name and email.
- Optional: a **paid-tier** Gemini API key in `GEMINI_API_KEY` for
  `make frontier`. Deep Research is not available on the free tier.

## Run it

```bash
make doctor      # tools, Terraform version, AWS login, GPU quota, Docker
make env         # then edit .env: set SEC_USER_AGENT (and GEMINI_API_KEY)
make up          # VM + model + tunnel + laptop stack + make check
make truth-check # optional: confirm the committed answer keys still match upstream
make research    # LDR: 3 runs x 2 questions (RUNS=3, QUESTION=all|q1-kev|q2-msft)
make frontier    # Gemini: 3 runs x 2 questions (needs GEMINI_API_KEY)
make score       # scoreboard in the terminal and in results/scoreboard.md
make down        # destroy everything
```

`make plan` previews what `make up` creates. `make ssh` opens a shell on the
VM. `make tunnel` and `make tunnel-down` reopen or close the tunnel alone.
`make test` runs the bench tests, lint and type checks in Docker, the
Terraform security tests and shellcheck. The first `make up` takes a while:
the VM boots, vLLM pulls and loads the model, and the command returns only
when the model answers a chat completion and a tool call.

`make research` runs sequentially and can take a long time: each LDR research
is capped at 60 minutes and recorded as `timeout` if it does not finish. The
GPU bills the whole time, so run it when you can wait. An interrupted run
resumes at the next free `run-<n>`; existing run files are never overwritten.

## What you should see

<!-- results from the live run go here -->

_The scoreboard from the live run is added here once it exists. Your own run
will differ: the models, the search results and the web all move._

`make check` ends with three `ok` lines (see
[Why the model port is never public](#why-the-model-port-is-never-public)),
and `make down` ends with an empty `terraform state list` and a leftovers
check that reports everything `gone`.

## How it works

```
Laptop (docker compose)                     AWS eu-central-1, dedicated VPC
-----------------------                     ----------------------------------
bench (Python)  --HTTP--> ldr :5000         public subnet
                            |  |            +---------------------------------+
                            |  +-> searxng  | GPU VM g7e.2xlarge (no role,    |
                            |      (egress  |   no key pair, IMDSv2 hop 1)    |
                            |      from     | SG: ingress 22 from reader /32  |
                            |      home IP) | vllm  127.0.0.1:8000 only       |
                            v               |                                 |
          host.docker.internal:8000 ===ssh -L (port 22)===> 127.0.0.1:8000    |
                                            +---------------------------------+
bench frontier --HTTPS--> Gemini Interactions API (optional, GEMINI_API_KEY)
bench truth    --HTTPS--> CISA KEV feed, SEC EDGAR companyfacts
```

### The tunnel

`make up` opens one backgrounded `ssh -N -L 127.0.0.1:8000:127.0.0.1:8000`
with a control socket in the lab's gitignored `.ssh/` folder. Each SSH
connection uses a throwaway key pushed with EC2 Instance Connect (valid for
60 seconds); there is no key pair and no instance profile, and nothing is
written to `~/.ssh`. The VM's security group allows TCP 22 from your public
`/32` only, looked up from `checkip.amazonaws.com` unless you set
`ALLOWED_SSH_CIDR=203.0.113.7/32`. **If your IP changes, run `make up`
again**; it re-applies the rule.

LDR runs in a container, so it reaches the laptop's loopback tunnel as
`http://host.docker.internal:8000/v1`. That works on Docker Desktop because
`host.docker.internal` is forwarded to the host's loopback.

### Why the model port is never public

vLLM listens on the VM's `127.0.0.1:8000` only, and the security group has no
rule for port 8000. `make check` proves it three ways: the model answers
through the tunnel on your laptop; a request to `http://<VM public IP>:8000`
must end in "connection refused" or a timeout (any HTTP answer is a failure);
and the lab's own in-network check, run from inside the compose network, can
reach LDR, the model and log in. The Terraform tests (`make test`) also fail
if any ingress other than TCP 22 from a single IPv4 `/32` appears.

### The answer keys

- **Q1, `q1-kev`**: every CVE that CISA added to the Known Exploited
  Vulnerabilities catalog between 2026-10-01 and 2026-10-31 (36 entries, with
  vendor and product), taken from CISA's JSON feed.
- **Q2, `q2-msft`**: Microsoft's GAAP revenue, net income and diluted EPS for
  the 8 fiscal quarters ended 2024-12-31 through 2026-09-30, taken from SEC
  EDGAR `companyfacts`. Microsoft's fiscal year ends on 30 June.

SEC does not publish Q4 as its own number, so **Q4 is derived as the annual
value minus the nine-month year-to-date value**. FY25 Q4 comes out as revenue
76,441 and net income 27,233 (USD millions) and diluted EPS 3.65, matching
Microsoft's published results. Q4 EPS by subtraction can differ from the
published figure by a cent because the share count changes within the year;
the +/-0.5 % tolerance absorbs it at these magnitudes.

`make truth` rewrites `data/truth/*.json` and `make truth-check` compares them
without writing. Treat both as a **drift detector**: a difference means the
upstream data changed (for example a KEV entry was edited or an SEC filing
was amended), not that the code is wrong. Changes to the KEV catalog version
string alone are ignored.

### The output contract and the scoring

Each question prompt starts with "Today's date is YYYY-MM-DD." and ends by
telling the tool that the report may be any length but must finish with
exactly one fenced `json` block in a fixed schema and nothing after it. The
scorer parses the **last** fenced `json` block. A missing block, invalid JSON
or the wrong shape scores 0 and counts as a format failure.

- **Q1**: CVE IDs are upper-cased and trimmed, and duplicates collapse. The
  scoreboard reports precision, recall and F1 over the ID set (F1 is the
  primary score), vendor accuracy for the correctly listed CVEs, and
  `mentioned_recall`: how many true CVEs appear anywhere in the report text.
- **Q2**: 24 cells (8 quarters x 3 metrics). A cell is correct when it is
  within 0.5 % of the truth; a missing quarter is 3 wrong cells; extra
  quarters are ignored; `quarter_end` must match exactly. The primary score
  is the share of correct cells.

The scoreboard also shows runs, min/mean/max, format failures, mean wall time,
mean cost, mean source count, a per-run table and a "where it went wrong"
list of missed and invented CVEs and wrong cells (answer vs truth). Cost for
LDR is wall hours times the instance price (5.71915 USD/h, overridable with
`INSTANCE_PRICE_USD_PER_HOUR`); Gemini cost comes from the reported token
usage and a dated rate table at the base (up to 200k-token prompt) rates. The
API reports totals summed over the agent's many model calls, so it cannot
show which calls crossed into the long-context tier: read the Gemini cost as
an estimate, closer to a floor than a ceiling. Gemini's sources are the links
it lists in its report.

### The settings that matter

| Setting | Value | Why |
| --- | --- | --- |
| Model | `Qwen/Qwen3.6-27B-FP8`, pinned revision, served as `qwen3.6-27b`, thinking on | 28.75 GiB of weights on a 96 GiB RTX PRO 6000 leaves room for a long KV cache |
| vLLM `max_model_len` | 131072 | The context window the VM serves; the model card asks for at least 128k so thinking is not cut short |
| LDR `LLM_CONTEXT_WINDOW_SIZE` | 131072 | Must equal the server's window |
| LDR `LLM_MAX_TOKENS` | 16384 | **Capped on purpose.** LDR treats an OpenAI-compatible endpoint as a cloud model and would otherwise ask for 30000 output tokens per call; on the 64k L40S setup that leaves too little room for the prompt and tool results, and 16384 still covers the model's thinking |
| Strategy | LDR's default, `langgraph-agent` | See below |
| Research mode | `quick` (one agent research, then a summary) | `detailed` writes a multi-section report and runs a fresh research per section: on this box one such run did not finish within an hour |
| Search | SearXNG on your laptop | Searches leave from your IP, not the VM's |

The strategy is deliberately LDR's out-of-the-box default so the result is
an honest "what you get by installing it". LDR advertises about 95 % on
SimpleQA, but that number came from a different setup: the same
`langgraph-agent`, but with Serper search, an Ollama-served model and a
self-graded judge, on short factual questions. This lab asks for long,
multi-item answers graded against official data, so the two numbers are not
comparable.

`LDR_MODEL` in `.env` is the model name `bench` sends when it starts a
research; it defaults to `qwen3.6-27b`. If you change it, also change
`LDR_LLM_MODEL` in `compose.yaml` (and the served model name on the VM) to
match, or leave both alone.

### Linux

This lab is written for Docker Desktop. On native Linux Docker,
`host-gateway` resolves to the docker bridge address (typically
`172.17.0.1`), not to the host's loopback, so a tunnel bound to
`127.0.0.1:8000` is not reachable from the containers. Linux is therefore **not covered** by the tested path. To adapt it, bind the
forward to the docker0 address instead (change the `-L 127.0.0.1:8000:...`
line in `scripts/vm_ssh.sh` to your docker0 address, for example
`172.17.0.1:8000:127.0.0.1:8000`) and point the loopback probes in
`scripts/vm_ssh.sh`, `scripts/tunnel.sh` and `scripts/reach_check.sh` at that
address too. Also on
Linux, `results/` and `data/` must be writable by **uid 10001**, the user the
bench container runs as:

```bash
mkdir -p results data && sudo chown -R 10001 results data/truth
```

## Clean up

```bash
make down
```

This stops the compose stack, closes the tunnel, runs `terraform destroy`,
searches the Region for anything still tagged with the lab (all lines should
say `gone`) and prints `terraform state list`, which must be empty. Each
best-effort step (compose, tunnel) is allowed to fail without stopping the
rest. Run it even if `make up` failed half way.

## Troubleshooting

- **`make up` sits at `aws_instance.vm: Still creating...` and then fails
  with `InsufficientInstanceCapacity`**: AWS has no free GPU of that type in that
  zone right now. Run `make up ZONE=eu-central-1b`, and pass the same `ZONE`
  to `make down`. To use the cheaper L40S box instead (USD 2.80/h, when it
  has capacity), put `instance_type = "g6e.2xlarge"`, `max_model_len = 65536`
  and `max_num_seqs = 8` in `terraform/terraform.tfvars` and set
  `LDR_LLM_CONTEXT_WINDOW_SIZE` in `compose.yaml` to 65536.
- **My IP changed** (SSH hangs or is refused): run `make up` again; Terraform
  updates the security group rule and the tunnel reopens.
- **SEC answers 403 during `make truth`**: set `SEC_USER_AGENT` in `.env` to
  your own name and email; the placeholder is refused.
- **LDR login rate limit**: LDR allows 5 logins per 15 minutes and `bench`
  logs in once per command. Wait 15 minutes, and prefer one `make research`
  with `RUNS=3` over many small ones.
- **`make score` says "no run files"**: there is nothing under
  `results/runs/` yet. Run `make research` or `make frontier`.
- **A run is `timeout` or `failed`**: the run file is still written with that
  status and a score of 0; the command carries on with the next run.
- **`make frontier` refuses to start**: `GEMINI_API_KEY` is empty or not a
  paid-tier key.
