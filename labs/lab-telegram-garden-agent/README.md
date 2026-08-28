# Telegram garden agent

Talk to a mock indoor garden — the kind of thing you'd eventually wire to a
Raspberry Pi and real sensors — from anywhere, through your own private
Telegram bot. A LangGraph agent backed by the Anthropic API reads and
controls four plants over four typed tools. The container makes no inbound
network connections at all: it only dials out to Telegram and Anthropic.

## What you'll learn

- Running a Telegram bot as a private assistant: a chat-ID allow-list is the
  entire authorization model, and every other chat gets a canned refusal.
- Why long polling — the bot repeatedly asking Telegram "anything for me?" —
  beats webhooks for a home lab: it's outbound-only, so there's nothing to
  expose on your router or a public URL to maintain.
- Why calling a hosted model over the API beats running one on-device on
  Pi-class hardware: no GPU, no multi-gigabyte weights to manage, and a
  small, fast model is plenty for a handful of tool calls.
- Wiring typed LangChain tools against a mocked sensor layer, so the agent
  logic is fully testable before it ever touches real hardware.

## Architecture

```
                    ┌──────────────┐
   your phone  ───► │  Telegram    │
                    │  (cloud)     │
                    └──────┬───────┘
                           │ long poll (outbound only)
                           ▼
                 ┌─────────────────────────────────────────────┐
                 │ container                                   │
                 │                                             │
                 │  grammY ──► agent ──► 4 tools ──► garden    │
                 │               │                  simulator  │
                 │               │                             │
                 └───────────────┼─────────────────────────────┘
                                 ▼
                          Anthropic API
```

Your message reaches the container through Telegram's long-polling API, not
through any port you open. The agent decides which of the four tools to
call — list the plants, read a temperature or humidity sensor, or add water
— and the garden simulator returns a deterministic reading or updates its
in-memory moisture state. The simulator sits behind a small, clean
interface (`listPlants`, `measureTemperature`, `measureHumidity`,
`putWater`), so swapping it for real GPIO-connected sensors later touches
nothing above it.

## Prerequisites

- Docker with Compose
- A Telegram account
- An Anthropic API key

## Create your private bot

1. Message [@BotFather](https://t.me/BotFather) on Telegram and send
   `/newbot`. Follow the prompts and copy the bot token it gives you.
2. Get your own numeric chat ID, either:
   - message [@userinfobot](https://t.me/userinfobot) and read the ID it
     replies with, or
   - text your new bot once, then run
     `curl https://api.telegram.org/bot<TOKEN>/getUpdates` and read
     `message.chat.id` from the response.

## Configure

```bash
cp .env.example .env
```

Fill in `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ALLOWED_CHAT_ID`, and
`ANTHROPIC_API_KEY`. Every variable:

| Variable                    | Required             | Default            | Meaning                                              |
| ---------------------------- | --------------------- | ------------------- | ----------------------------------------------------- |
| `ANTHROPIC_API_KEY`          | yes                   | —                   | Anthropic API key the agent uses for inference.        |
| `CLAUDE_MODEL`                | no                    | `claude-haiku-4-5`  | Claude model the agent runs on.                        |
| `TRANSPORT`                   | no                    | `telegram`          | `telegram` for the live bot, `script` for verification.|
| `TELEGRAM_BOT_TOKEN`          | yes (telegram only)  | —                   | Bot token from @BotFather.                             |
| `TELEGRAM_ALLOWED_CHAT_ID`    | yes (telegram only)  | —                   | Your numeric chat ID; every other chat is refused.     |
| `GARDEN_SEED`                 | no                    | `42`                | Seed for the deterministic garden simulator.           |
| `LOG_LEVEL`                    | no                    | `info`              | pino log level.                                        |

`ANTHROPIC_API_KEY` example: `sk-ant-your-key-here`.

## Run it

```bash
docker compose up --build
```

Then, from your phone, message your bot:

- "What plants do I have?"
- "How warm is plant 3?"
- "Give plant 2 150 ml of water"

Messages from any chat other than the one in `TELEGRAM_ALLOWED_CHAT_ID` get
a fixed refusal reply instead of reaching the agent.

## Verify it without Telegram

```bash
docker compose run --rm -e TRANSPORT=script garden-agent
```

This runs a fixed four-turn conversation straight through the real agent
and the real Claude model — no Telegram involved — and checks that each
turn produced the expected tool call, including the exact watering delta
on plant 2. It exits `0` when every check passes and prints "Scripted
verification succeeded. All checks passed." It only needs
`ANTHROPIC_API_KEY` set in `.env`.

## Run it on a real Raspberry Pi (optional)

The base image is multi-arch, so on a 64-bit Pi OS install this is the same
two commands as anywhere else: `git clone` the repo, then
`docker compose up --build` in this lab's folder. To build the image on a
laptop and ship it to the Pi instead, use:

```bash
docker buildx build --platform linux/arm64 -t garden-agent .
```

The Pi path isn't covered by the automated verification above — it's an
extension, not a requirement, for anyone who wants to see this running on
real hardware.

## Security notes

- The container makes no inbound connections and publishes no ports —
  long polling means it only ever dials out to Telegram and Anthropic to
  ask "anything for me?" and to run inference.
- The chat-ID allow-list is checked on every message; anything from a
  chat that isn't yours gets refused before it reaches the agent or any
  tool.
- Your bot token and API key live only in the untracked `.env` file,
  never in the image or in git.

## Development without Docker

Compose passes `.env` to the container for you; outside Docker nothing
loads it automatically, so `npm start` alone will fail on missing config.
Use `npm run dev` instead — it runs the app with Node's
`--env-file-if-exists=.env` flag (Node 22+), which loads `.env` before
`src/index.ts` runs:

```bash
npm install
npm run dev
npm test
npm run lint
npm run knip
npm run typecheck
```
