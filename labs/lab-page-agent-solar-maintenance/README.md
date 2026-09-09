# Solar maintenance logbook, driven by an in-page agent

A service engineer finishes a job and types one sentence — "replaced the
string 3 inverter fan on the Almeria roof array this morning, took two
hours, panel 14 still shows a hotspot" — and an agent embedded in the app
opens the right site, finds the report form, fills six fields, ticks the
follow-up box, and submits. It does this by reading the page the same way a
person does: no headless browser, no browser extension, no Python sidecar
driving it from outside. [`page-agent`](https://github.com/alibaba/page-agent)
runs inside the tab and operates the DOM directly — clicking, typing,
selecting.

The interesting part isn't the agent, it's where the model credential lives.
An in-page agent's model calls originate in the browser, so if the API key
lived there too, anyone with devtools open could read it out. This lab
relays every call through the app's own backend on the engineer's session
token instead, and is honest about exactly what that relay can and can't
protect.

> Companion post: [{{POST_TITLE}}]({{BLOG_POST_URL}})

## What you'll learn

- How to keep a model credential out of the browser entirely when the agent
  driving the UI has to live in the browser: a `customFetch` seam that
  attaches the user's own session token, and nothing else.
- What a relay in front of a browser-composed prompt can actually enforce
  (identity, model choice, request size, call volume) and what it flatly
  cannot (the prompt itself) — and why that's an honest limit, not a bug.
- The concrete markup changes a page needs before a DOM-reading agent can
  operate it: native controls, stable `name` attributes, and designing for
  an agent that can't read back what it just typed.
- Why an in-page agent's first move is usually to wait: a route renders
  before its data arrives, and a script can out-run that fetch in a way no
  human tester ever does.
- Running the whole thing — UI, backend relay, and a scripted stand-in model
  — with zero credentials, so the default path costs nothing and leaks
  nothing.

## Architecture

```
┌───────────────────────────── Browser ───────────────────────────────┐
│  React SPA, served on :5173                                         │
│                                                                      │
│   Sites → Site → Report form        window.pageAgent (page-agent)   │
│        ▲                       DOM   ┌─────────────────────────┐    │
│        └───────────────────────────► │ reads the rendered page, │    │
│                                       │ clicks, types, selects.  │    │
│                                       │ NO model key here, ever. │    │
│                                       └────────────┬─────────────┘    │
└────────────────────────────────────────────────────┼─────────────────┘
                                                       │ POST /api/agent/v1/chat/completions
                                                       │ Authorization: Bearer <session JWT>
                                                       │ (the ONLY thing that ever leaves the tab)
                                                       ▼
┌────────────────────────────── Backend, :8080 ───────────────────────┐
│  auth ──► guard (allowlist + size cap) ──► budget ──► transport      │
│                                                          │           │
│                     LLM_MODE=scripted (default) ─────────┤           │
│                     LLM_MODE=gemini  (optional) ──────────┘          │
│                                       │                              │
│              GEMINI_API_KEY lives ONLY here, in the backend's own    │
│              environment. It never travels to the browser and the    │
│              browser's own header never travels upstream.            │
└───────────────────────────────────────┼─────────────────────────────┘
                                         │ (only when LLM_MODE=gemini)
                                         ▼
                    generativelanguage.googleapis.com
```

## Prerequisites

- Docker with Compose
- Node.js 22 (only to run the e2e suite on the host — the app itself runs
  entirely in containers)
- A Gemini API key — **optional**. The default `LLM_MODE=scripted` needs no
  credentials at all and makes no outbound network call.

## Run it

```bash
docker compose up --build
```

Wait for the backend's healthcheck to pass (a few seconds), then open
`http://localhost:5173` and sign in as the seeded engineer:

- Email: `rosa@example.com`
- Password: `solar`

Once you're signed in, the agent's own panel appears at the bottom of the
page — that's the whole interface. Click into its input and type one
sentence:

```
replaced the string 3 inverter fan on the Almeria roof array this morning, took two hours, panel 14 still shows a hotspot
```

Press Enter and watch it work.

(`window.pageAgent.execute(task)` also exists on the page — the automation
path the e2e suite uses to drive the same task without touching the panel's
markup — but the panel is how an engineer actually uses this.)

## What you should see

The panel appears docked at the bottom of the page as soon as you're signed
in, with a status line ("Ready") and the task input underneath it. The
moment you press Enter, that status line takes over as a live feed —
"Clicking element [0]...", "Selecting option...", "Inputting text..." — and
its step list grows one entry per action, so you can watch the plan unfold
instead of waiting on a result.

A run against the "Almeria Roof Array" site — one of four seeded sites —
takes about 12 steps and 13 seconds: `wait` (the list hasn't loaded yet),
then a chain of clicks, a dropdown selection, and four typed fields,
finishing with a click on "Submit report". The browser lands on `/reports`
with a new row: component "String 3 inverter", type "Inverter", today's
date, "2h", the typed summary, and the follow-up note about panel 14.

If you want to see the credential story rather than take it on faith, open
the Network tab while it runs: every one of those calls goes to
`/api/agent/v1/chat/completions` on `localhost:5173` itself, each carrying
`Authorization: Bearer eyJ...` — the app's own session JWT. Nothing shaped
like `AIza...`, `sk-...`, or an `x-goog-api-key` header ever appears, because
the library was never given a key to send.

## Run the tests

With the stack from **Run it** still running (or start it detached with
`docker compose up -d --build`), in another terminal:

```bash
cd e2e
npm ci
npx playwright install chromium
npm run e2e
```

Six tests in about 27 seconds: an unauthenticated relay call is rejected, a
forged token is rejected, the client's chosen `model` is silently
overridden, an oversized request is refused, the browser only ever sends the
session JWT (never a provider credential), and — the one that matters most —
the agent navigates the real app end to end and actually files the report.

## How it works

**The `customFetch` seam.** `page-agent`'s `PageAgent` is constructed with no
`apiKey` at all — not empty, not a placeholder, the property is simply never
set, so the library never has anything to attach as an `Authorization`
header on its own. `customFetch` intercepts every outgoing request and
attaches the *engineer's* session token instead, read fresh on each call.
The model credential and the user credential never touch the same code
path.

**The four relay controls, and one honest limit.** The backend sits between
the browser and the model provider, and it can enforce:

1. **Authenticate** — the session JWT is verified before anything else in
   the request is even looked at. No token, or a forged one, is a flat 401.
2. **Pin and allowlist** — of everything the client sends, only `messages`,
   `tools`, `tool_choice`, and `parallel_tool_calls` are forwarded. `model`
   and `max_tokens` always come from server config, so a client cannot pick
   a different model or demand a bigger response. The caller's own
   `Authorization` header is consumed by the relay and never forwarded
   upstream.
3. **Cap** — request size (messages *and* tools together, since a tiny
   message array can hide a huge tool schema) and message count are both
   bounded, checked before anything is relayed.
4. **Budget** — a per-user sliding-window call budget (120 calls per 300
   seconds by default) returns 429 once it's spent.

What this relay cannot do is filter the prompt. With an in-page agent, the
entire prompt — system message included — is composed in the browser from
whatever the page currently looks like. There is nothing server-side to
compare it against, so the backend is a relay for a prompt it did not
author, not a content filter. Identity, model pinning, size caps, and budget
are what actually hold here; prompt filtering isn't one of the controls, and
this lab doesn't pretend otherwise.

**What the agent can and can't see.** `page-agent` reads the page through
three declarative escape hatches, none of which this lab needs but any
production integration should know about: `data-page-agent-ignore="true"`
removes an element and everything under it from the agent's view entirely,
`data-page-agent-not-interactive` leaves an element's text visible but makes
it unclickable, and standard `aria-hidden="true"` elements are dropped too.

**Why the DOM is the whole API.** There's no separate structured interface
for the agent to call — it perceives the page exactly the way the DOM
renders it, and acts on it the same way a mouse and keyboard would. That's
what makes it work on an app that was never built with an agent in mind,
and it's also the source of every quirk in the next section.

One thing worth knowing if you deploy this behind a strict CSP: the
`page-agent` bundle ships a direct `eval`, used to implement its
`execute_javascript` tool. This lab never enables that tool, but the `eval`
still ships in the bundle, so a page with a CSP that omits `unsafe-eval`
inherits it regardless.

## Making a page an agent can operate

Building the report form against a real DOM-reading agent surfaced a
handful of concrete rules — not generic advice, things that broke or would
have broken:

- **The dropdown has to be a native `<select>`.** `page-agent`'s
  `select_dropdown_option` tool throws "Element is not a select element" on
  anything else, so a styled `div`-based combobox simply cannot be driven.
- **Match controls by `name`, not `id`.** `<label>` elements are indexed by
  the agent right alongside inputs, so "match the label text" isn't a safe
  shortcut either. And when an `id` duplicates its element's `name`, the
  walker silently drops the `id` attribute from what the agent sees — `name`
  is the one attribute you can rely on.
- **The agent cannot read back what it typed.** It perceives HTML
  attributes, not live DOM properties, and a React-controlled input never
  writes its value back to the `value` attribute. The only exception is
  `checked` on checkboxes and radios, which the walker does reflect live.
  Anything else has to be tracked in the agent's own step history, not
  re-read from the page.
- **Attribute values are truncated to 20 characters** in what the agent
  sees, so short, distinct `name`s matter more than they would for a human
  reading the markup.
- **The first action is usually `wait`, and that's correct.** This app
  renders a route immediately and fetches its data afterward, so an agent
  that looks at the page within the first few hundred milliseconds sees an
  empty list. Treating "the intent applies but its control isn't there yet"
  as a reason to wait — rather than give up — is what makes the run
  reliable.

## Clean up

```bash
docker compose down
```

Nothing else persists: the fleet and report data live only in the backend
process's memory and reset on the next `up`, and if you created a `.env` for
the Gemini path, it's gitignored and stays on your machine — delete it with
`rm .env` if you want it gone too.
