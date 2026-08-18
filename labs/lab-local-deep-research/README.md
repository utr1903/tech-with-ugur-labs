# Deep research on your own laptop

A TypeScript CLI that runs "deep research" entirely against a local model.
`search` scopes the question, searches the web at depth, and writes a cited
markdown report; `analyze` answers questions grounded in everything you have
researched — all driven by `qwen3:4b` running in Ollama on your machine.
Only the web-search API calls leave your laptop.

Built on the LangGraph Deep Agents harness (`deepagents`):
filesystem-as-memory and a deliberately trimmed toolset so a 4B model can
drive the loop reliably — every model turn spent on research, none on
bookkeeping.

Companion post: [Deep Research on Your Own
Laptop](https://utr1903.github.io/tech-with-ugur-blog/posts/local-deep-research/).

## Prerequisites

- Node 22+
- [Ollama](https://ollama.com) running natively — no Docker here, since the
  model needs Metal/GPU acceleration that containers don't get on macOS
- A free [Tavily](https://app.tavily.com) API key (1,000 search
  credits/month, no card)

## Run it

```bash
ollama pull qwen3:4b
cp .env.example .env        # put your Tavily key in TAVILY_API_KEY
npm ci
npm run search -- "What is the Model Context Protocol and who created it?"
```

Watch the JSON logs stream every step — each model turn and every tool call
(searches and file operations alike) logs when it starts, succeeds, or
fails, so you always know what the agent is doing. Then interrogate your
research corpus:

```bash
npm run analyze -- "Who created the Model Context Protocol?"
npm run analyze              # interactive session
```

## What you should see

`search` takes roughly 10–15 minutes on Air-class hardware — the agent works
through the question in about 6–9 sequential model turns (brief, 3–5
deep searches, report), and every one of them shows up in the logs as it
happens. The result lands in `research/<topic-slug>/report.md` with a
`## Sources` section of real URLs it actually cited, alongside `brief.md`
and a `notes/` folder holding the full, untruncated results of every
search. Be honest with your expectations: this is a rig for learning how
deep agents work, not a Google replacement — on a laptop CPU/iGPU each
model turn costs about a minute, and it only starts feeling fast on a
machine with a real GPU or with a larger model.

`analyze` is much faster: a one-shot question answers in well under a
minute, since it's just reading the files the search step already wrote.
The interactive session (`npm run analyze` with no question) repeats that
for as many questions as you ask, until you submit an empty line.

## How it works

- `search` builds a deep agent with one custom tool (`internet_search`,
  backed by Tavily at advanced search depth) plus file tools, rooted at
  `research/<topic-slug>/`. The system prompt walks it through
  scope → research → report phases.
- The search tool does the bookkeeping so the model doesn't have to: each
  call archives its full results to `notes/` in code, and a search failure
  comes back to the model as structured content it can react to — one lost
  turn instead of a dead 10-minute run. The model only spends turns on the
  brief, the queries, and the report.
- `analyze` builds a read-only-by-convention agent (`ls`/`read_file`/`glob`/
  `grep`) over the whole `research/` tree, and strips any `<think>...</think>`
  reasoning the model leaks into its final answer before printing it.
- Small-model tricks that make this work on 4B:
  - today's date pinned in every system prompt — a local model's sense of
    "now" is frozen at its training cutoff, so without this, "current" and
    "latest" quietly mean the model's training year, in search queries too
  - thinking mode off and temperature 0 on the Ollama chat model — a 4B
    model calls tools reliably only with deterministic sampling
  - a mandatory system-prompt rule: at most one tool call per turn
  - a tool-allowlist middleware that hides every tool the model doesn't
    strictly need for the task at hand, including the harness's subagent
    `task` tool — re-enabling it is a natural extension if you're running a
    larger model that can be trusted to delegate sub-tasks sensibly
  - a hard step budget (`MAX_AGENT_STEPS`, passed as LangGraph's
    `recursionLimit`) so a confused agent fails fast instead of looping
  - a middleware that flattens tool output to plain strings, since
    `@langchain/ollama` only accepts string content on tool messages
  - a salvage path in `search`: when the model composes the finished report
    in its reply instead of calling write_file (a real observed failure),
    the CLI saves that reply to `report.md` in code rather than letting a
    15-minute run die
  - a step-logging middleware that wraps every model turn and every tool
    call — the built-in file tools included — so a multi-minute run is
    never a black box
  - `virtualMode: true` on the filesystem backend, so the agent's absolute
    file paths (`/report.md`, `/notes/*.md`) stay inside the research
    folder instead of escaping onto your real disk

## Verify

```bash
npm test     # unit tests — no network, no model
npm run e2e  # full search + analyze against live Ollama and Tavily; ~15-30 min
```

`npm run e2e` needs Ollama running with `qwen3:4b` pulled and a valid
`TAVILY_API_KEY` in `.env`.

## Knobs

All optional, via `.env`:

- `OLLAMA_MODEL` — try `qwen3:8b` if 4B misbehaves
- `OLLAMA_BASE_URL` — where Ollama is listening
- `OLLAMA_NUM_CTX` — context window size
- `MAX_AGENT_STEPS` — step budget for `search`
- `SEARCH_MAX_RESULTS` — Tavily results per query
- `RESEARCH_DIR` — where topic folders are written
- `LOG_LEVEL` — pino log level

## Clean up

```bash
rm -rf research research-e2e
ollama rm qwen3:4b   # optional — only if you don't want to keep the model
```
