# Deep research on your own laptop

A TypeScript CLI that runs "deep research" entirely against a local model.
`search` plans, searches the web, takes notes, and writes a cited markdown
report; `analyze` answers questions grounded in everything you have
researched — all driven by `qwen3:4b` running in Ollama on your machine.
Only the web-search API calls leave your laptop.

Built on the LangGraph Deep Agents harness (`deepagents`): planning todos,
filesystem-as-memory, and a deliberately trimmed toolset so a 4B model can
drive the loop reliably.

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

Watch the JSON logs as the agent plans, searches, and writes files. Then
interrogate your research corpus:

```bash
npm run analyze -- "Who created the Model Context Protocol?"
npm run analyze              # interactive session
```

## What you should see

`search` takes roughly 12–20 minutes on Air-class hardware — the agent
works through the question in about 18 sequential model turns (plan, brief,
a few searches, notes, report). The result lands in
`research/<topic-slug>/report.md` with a `## Sources` section of real URLs
it actually cited, alongside `brief.md` and a `notes/` folder of the raw
findings.

`analyze` is much faster: a one-shot question answers in well under a
minute, since it's just reading the files the search step already wrote.
The interactive session (`npm run analyze` with no question) repeats that
for as many questions as you ask, until you submit an empty line.

## How it works

- `search` builds a deep agent with one custom tool (`internet_search`,
  backed by Tavily) plus planning todos and file tools, rooted at
  `research/<topic-slug>/`. The system prompt walks it through
  scope → research → report phases.
- `analyze` builds a read-only-by-convention agent (`ls`/`read_file`/`glob`/
  `grep`) over the whole `research/` tree, and strips any `<think>...</think>`
  reasoning the model leaks into its final answer before printing it.
- Small-model tricks that make this work on 4B:
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
  - `virtualMode: true` on the filesystem backend, so the agent's absolute
    file paths (`/report.md`, `/notes/*.md`) stay inside the research
    folder instead of escaping onto your real disk

## Verify

```bash
npm test     # unit tests — no network, no model
npm run e2e  # full search + analyze against live Ollama and Tavily; ~15-40 min
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
