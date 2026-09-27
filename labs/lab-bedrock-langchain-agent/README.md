# One agent, four models: Amazon Bedrock with LangChain in TypeScript

A small Hono service that answers plain-English questions about a seeded shop
database — customers, products, orders — by calling three typed, read-only
tools instead of writing SQL. One LangChain agent does the work, and a field
in each request picks which of four open-weight models on Amazon Bedrock sits
behind it, with no code change. Every model turn and every tool call is
logged as it happens, so you can compare how the four models use the same
tools on the same question.

> Companion post: [One agent, four models: Amazon Bedrock with LangChain in TypeScript](https://techwithugur.dev/posts/bedrock-langchain-agent/)

## Prerequisites

You need on your host:

- Docker with Compose
- Make
- AWS CLI 2.32.0 or newer (`aws login` needs it)
- An AWS account with access to the four models below

Node.js is **not** needed on the host. The app, the tests and the e2e script
all run inside containers.

**Model access.** The identity you sign in with needs permission to invoke
Bedrock models (`bedrock:InvokeModel`), and the four models must be available
to your account in the Region you use. `make check` tells you per model. If a
model fails there, open that model in the Bedrock console's model catalog and
follow what it asks for.

`make check`, `make ask` and `make e2e` call Bedrock; there is no offline
mode. `make e2e` makes twenty short calls (five questions on four models).
Budget a few cents per run.

## Run it

```bash
make login
make up
make ask MODEL=kimi-k3 Q="How many customers live in Vienna?"
make e2e
make down
```

`make help` lists every target.

## What you should see

**`make login`** runs `aws login` for the profile the app will use
(`AWS_PROFILE`, see Settings). It signs you in with the same credentials you use for the AWS console and may ask for a Region on first
use. It opens a browser tab; once you approve there, the terminal returns and
the session is stored in `~/.aws/login/cache` on your host.

**`make up`** first runs the same preflight as `make check`, on your host:

```
Checking profile "default" in Region "us-east-1"
  ok    AWS CLI 2.37.4
  ok    AWS config file exists
  ok    Login cache directory exists
  ok    Signed in as arn:aws:iam::<account>:user/<you>
  ok    Region offers the in-Region models
  ok    Model minimax-m2.5 answers
  ok    Model nemotron-super-3 answers
  ok    Model deepseek-v3.2 answers
  ok    Model kimi-k3 answers

All checks passed.
```

If any check fails, `make up` stops there. Otherwise Compose builds the image
and starts Postgres and the app, and waits until both report healthy. The app
runs its migrations and seeds the database before it starts listening, so
once `make up` returns, `http://127.0.0.1:3000` answers. A third service,
`test`, behind the `test` profile, runs the unit tests for `make test`; it has
no AWS mounts, because no test calls AWS.

**`make ask`** sends one question and prints the JSON response. This question
needs all three tools:

```
make ask MODEL=deepseek-v3.2 Q="Which product did the customer Brionna Ebert order, and how many units?"
```
```json
{
  "answer": "Brionna Ebert ordered 3 units of the Bespoke Gold Car.",
  "model": "deepseek-v3.2",
  "toolCalls": [
    { "name": "query_customers", "args": { "name": "Brionna Ebert" }, "ok": true, "total": 1 },
    { "name": "query_orders", "args": { "customer_id": 20 }, "ok": true, "total": 1 },
    { "name": "query_products", "args": { "id": 15 }, "ok": true, "total": 1 }
  ],
  "durationMs": 6820
}
```

**`make e2e`** runs a few sanity checks against the running stack, asks the
five committed questions in `e2e/questions.ts` on all four models, and ends
with a pass/fail grid:

```
PASS  GET /readyz returns 200  (200)
PASS  Row counts are 20/15/60  (20/15/60)
PASS  No order is orphaned  (0 orphaned)
PASS  customer-lookup on minimax-m2.5
...
PASS  orders-across-tables on kimi-k3
PASS  Unknown model returns 400  (400)
PASS  Missing query returns 400  (400)

question              minimax-m2.5      nemotron-super-3  deepseek-v3.2     kimi-k3
-----------------------------------------------------------------------------------
customer-lookup       PASS              PASS              PASS              PASS
customer-filter       PASS              PASS              PASS              PASS
product-lookup        PASS              PASS              PASS              PASS
product-filter        PASS              PASS              PASS              PASS
orders-across-tables  PASS              PASS              PASS              PASS

20 of 20 passed
```

Each cell is asked once, with no retry. It passes when the response shows at
least one tool call and the answer contains every expected value after
normalizing (lowercase, no currency symbols, thousands separators or
markdown emphasis; a number counts only when it stands alone). A right answer
without a tool call fails.

Most runs pass every cell; an occasional run loses a cell to the service.
A cell that fails with `BEDROCK_ERROR` or `REQUEST_TIMEOUT` is the service or
the model being slow, not the lab: run `make e2e` again. A cell that fails
with "expected ..., got ..." or "no tool call" is the model's own answer.

## Settings

Every setting has a working default. The variables in `.env.example`:

| Variable | What it does | Default |
| --- | --- | --- |
| `AWS_PROFILE` | the AWS profile for `make login`, the preflight and the app | `default` |
| `AWS_REGION` | the Region for the preflight and every Bedrock call | `us-east-1` |
| `APP_PORT` | the host port the app is published on, on `127.0.0.1` | `3000` |
| `LOG_LEVEL` | the app's pino log level | `info` |
| `POSTGRES_PASSWORD` | the database password; for local use only, the database is not published to the host | `shop-local-only` |

Set them in a `.env` file (copy `.env.example`) or in the shell, for example
`AWS_REGION=eu-west-2 make up`. A value in the shell or on the `make` command
line wins over `.env`, which wins over the default. Compose reads `.env` for
the app; `make check` and `make login` read `AWS_PROFILE` and `AWS_REGION`
from it through `scripts/settings.sh`, which treats the file as plain text.

## How it works

### How sign-in reaches the container

`aws login` is the AWS CLI's browser-based sign-in: no access key is created
or stored. You approve the request in your browser, and the CLI writes a
short-lived session to a cache file on your host. The app container gets no
credentials of its own; two bind mounts in `compose.yaml` let it use that
same session:

| What | Mounted? | Access |
| --- | --- | --- |
| `~/.aws/config` | yes | read-only |
| `~/.aws/login/cache` | yes | read and write |
| `~/.aws/credentials` | no | — |
| `~/.aws/sso/` | no | — |
| `~/.aws/cli/` | no | — |

What this exposes: the container can use your signed-in session, with all the
permissions of the identity you signed in as, for as long as the session
lasts (up to 12 hours). The read-only config file also shows it the names of
all your profiles. Sign in with an identity that is limited to what the lab
needs (invoking Bedrock models), not an administrator.

The cache has to be writable because the credentials in it last 15 minutes.
The AWS SDK in the container refreshes them itself and writes the new ones
back to the same file, for up to 12 hours after `aws login`. This was
verified: a container left running for more than 15 minutes refreshed the
file, which kept mode `600` and its owner on the host.

When the session has expired, `make login` is enough. The app reads the
sign-in files again on the next request, so no restart is needed.

**Linux note.** This lab was run on macOS with Docker Desktop; the Linux path
below is described but was not tested. The app runs as the user `node`,
uid 1000. On Linux the sign-in cache is readable only by the user who owns
it, so if your uid is not 1000, the first question returns 502
`AWS_LOGIN_REQUIRED`. The way out: add `user: "<uid>:<gid>"` (from `id -u` and
`id -g`) to the `app` service in `compose.yaml`. `HOME` is already set to
`/home/node` for that case. npm may print a warning that it cannot write its
cache directory; that is harmless. Running Compose with `sudo` mounts root's
`~/.aws`, not yours.

### The dataset

The database is generated from a fixed seed, so its content is exactly
reproducible:

| Table | Columns | Rows |
| --- | --- | --- |
| `customers` | id, name, email, city, country, created_at | 20 |
| `products` | id, name, category, price_cents, stock | 15 |
| `orders` | id, customer_id, product_id, quantity, status, ordered_at | 60 |

- Customers live in 5 cities (Munich, Vienna, Lyon, Porto, Ghent).
- Products fall into 4 categories (Audio, Kitchen, Outdoor, Office), at least
  three each. Prices run $4.99 to $499.99, stored as whole cents. Stock is a
  unique number from 1 to 200, so "lowest stock in a category" has one answer.
- Orders have quantities from 1 to 5 and one of four statuses (pending,
  shipped, delivered, cancelled).
- Every date falls in 2026, up to a fixed reference date.

The seed is `SEED` in `src/db/seed-data.ts`. Change it and the dataset
changes, so the five questions in `e2e/questions.ts` no longer match. Run
`make test`: the test that compares them fails, and its diff shows the new
questions and expected answers.

### The tools

The agent never writes SQL. It makes a **tool call**, a structured request
naming one of three tools and its arguments; the app runs a parameterized
query and returns the result as a message the model reads on its next turn.

| Tool | Filters (all optional, combined with AND) | Use it for |
| --- | --- | --- |
| `query_customers` | id, name (partial match), email, city, country, limit | a customer's id, email, city, country; counting customers |
| `query_products` | id, name (partial match), category, limit | a product's id, name, category, price, stock |
| `query_orders` | id, customer_id, product_id, status, limit | what a customer ordered, how many, its status |

Every filter builds one `WHERE` clause with drizzle-orm's query builder
(`eq`, `ilike`, `and`), so a model's input never becomes part of the SQL.
`query_orders` returns `customer_id` and `product_id`, not names, on purpose:
answering "what did Brionna Ebert order" takes three chained calls (customer,
orders, product).

Every successful call returns the same shape,
`{ "ok": true, "rows": [...], "total": 1, "truncated": false }`. `limit`
defaults to 20 and caps at 100, but `total` always counts every matching row,
so a counting question is answered correctly even when the rows were cut off.
A database error returns
`{ "ok": false, "error": { "code": "DATABASE_ERROR", "message": "..." } }`
instead of throwing. Every query runs in a read-only transaction
(`db.transaction(fn, { accessMode: "read only" })`), so Postgres itself
refuses a write.

Numeric filters (`id`, `customer_id`, and so on) also accept a whole number
sent as text, because one model (DeepSeek V3.2) tends to send
`"customer_id": "20"` instead of `20`.

When a call's arguments don't fit the tool's schema, the model gets
`INVALID_ARGUMENTS` with each wrong field named, so it can correct the call;
any other failure gets `TOOL_CALL_FAILED`, with the details in the log only.
These codes are part of the tool result the model reads, not HTTP errors; the
failed call also appears in the response's `toolCalls` with `"ok": false`.
An abort or a timeout still ends the request. All of this happens in
`src/agent/logging-middleware.ts`.

### The models

`ChatBedrockConverse` talks to every model through Bedrock's **Converse
API**, one request and response shape for all models, which is what lets the
four share identical code.

| Request key | Bedrock identifier | Kind |
| --- | --- | --- |
| `minimax-m2.5` | `minimax.minimax-m2.5` | in-Region model ID |
| `nemotron-super-3` | `nvidia.nemotron-super-3-120b` | in-Region model ID |
| `deepseek-v3.2` | `deepseek.v3.2` | in-Region model ID |
| `kimi-k3` | `global.moonshotai.kimi-k3` | global inference profile |

All four are open-weight models. Every one is called with `temperature: 0`,
except `kimi-k3`, which rejects the field, so it is not sent. To add a model,
add one entry to `MODELS` in `src/agent/models.ts` and one matching
`key=bedrockId` line to `MODELS` in `scripts/check.sh`.

A **model ID** (like `minimax.minimax-m2.5`) calls that model in the Region
set by `AWS_REGION`. The Regions verified to offer all three in-Region models
are `us-east-1`, `us-east-2`, `us-west-2`, `eu-west-2` and `eu-north-1`; in any
other Region the preflight fails, so `make up` does not start the stack.

An **inference profile** (like `global.moonshotai.kimi-k3`) lets Bedrock route
the request to a Region with capacity. A `global.` profile can use any Region
worldwide, so you don't control where the request is processed, which matters
for, say, EU data residency. A `us.moonshotai.kimi-k3` profile also exists and
keeps requests in US Regions; to use it, change that entry's `bedrockId`.

### The API

**`GET /readyz`** returns `200 {"status":"ready"}`
(`curl -s http://127.0.0.1:3000/readyz`). The server starts listening only
after migrations and seeding are done.

**`POST /query`** takes `{"model": "kimi-k3", "query": "..."}`; `model` is one
of the four keys above, `query` is 1 to 500 characters. The response has
`answer`, `model`, `toolCalls` (one `{ name, args, ok, total }` per call) and
`durationMs`, as in the `make ask` example.

```bash
curl -s http://127.0.0.1:3000/query \
  -H 'content-type: application/json' \
  -d '{"model":"kimi-k3","query":"How many customers live in Vienna?"}'
```

All errors have the shape `{"error": {"code": "...", "message": "..."}}`.
`UNKNOWN_MODEL` also carries `validModels`, the list of keys, next to `error`.

| Status | Code | When |
| --- | --- | --- |
| 400 | `INVALID_REQUEST` | the body isn't JSON, or `model`/`query` fail validation |
| 400 | `UNKNOWN_MODEL` | `model` isn't one of the four keys |
| 404 | `NOT_FOUND` | any other path |
| 502 | `AWS_LOGIN_REQUIRED` | AWS didn't accept the credentials |
| 502 | `MODEL_ACCESS_DENIED` | your AWS identity can't use that model |
| 502 | `MODEL_UNAVAILABLE` | Bedrock rejected the call, often because the model isn't offered in this Region |
| 502 | `BEDROCK_ERROR` | Bedrock couldn't serve the request (throttled, overloaded, internal error) |
| 504 | `AGENT_LIMIT_REACHED` | the agent hit its step limit without an answer |
| 504 | `REQUEST_TIMEOUT` | the request passed the time limit |
| 500 | `INTERNAL_ERROR` | anything else |

A request may run for at most 10 model turns and 60 seconds (both in
`src/config.ts`). There is no authentication on `/query`, so `compose.yaml`
publishes the port on `127.0.0.1` only: reachable from your machine, not from
your network.

### Reading the logs

`make logs` follows the app's structured JSON logs (pino, one line per
event). These are lines of a real request, the `make ask` example above:

```
{"level":30,"time":"2026-09-27T20:46:30.825Z","appName":"shop-agent","requestId":"a2040fe2-3408-4dca-95d8-3807f075aed4","model":"deepseek-v3.2","queryLength":71,"msg":"Answering question..."}
{"level":30,"time":"2026-09-27T20:46:32.721Z","appName":"shop-agent","requestId":"a2040fe2-3408-4dca-95d8-3807f075aed4","model":"deepseek-v3.2","turn":1,"durationMs":1893,"toolCallsRequested":["query_customers"],"usage":{"input_tokens":1478,"output_tokens":77,"total_tokens":1555},"msg":"Model turn succeeded."}
{"level":30,"time":"2026-09-27T20:46:32.724Z","appName":"shop-agent","requestId":"a2040fe2-3408-4dca-95d8-3807f075aed4","model":"deepseek-v3.2","tool":"query_customers","args":{"name":"Brionna Ebert"},"msg":"Tool call..."}
{"level":30,"time":"2026-09-27T20:46:32.728Z","appName":"shop-agent","requestId":"a2040fe2-3408-4dca-95d8-3807f075aed4","model":"deepseek-v3.2","tool":"query_customers","total":1,"durationMs":4,"msg":"Tool call succeeded."}
{"level":30,"time":"2026-09-27T20:46:37.645Z","appName":"shop-agent","requestId":"a2040fe2-3408-4dca-95d8-3807f075aed4","model":"deepseek-v3.2","toolCalls":3,"durationMs":6820,"msg":"Answering question succeeded."}
```

The lines left out follow the same pattern: a `Model turn...` line before
each model turn, and one `Tool call...` and `Tool call succeeded.` pair per
tool call. Every line carries the same `requestId`, so you can pick one
request out of a busy stream:

```bash
make logs | jq -c 'select(.requestId == "a2040fe2-3408-4dca-95d8-3807f075aed4")'
```

### Code layout

```
src/
  index.ts                 startup order: config, logger, db, migrations, seed, tools, server, then listen
  config.ts                parses env vars; the model-turn / timeout / output-token limits
  logger.ts                the pino logger and the process-level error handlers
  db/
    schema.ts              the three drizzle tables: customers, products, orders
    seed-data.ts           the deterministic fake dataset generator
    seed.ts                inserts the generated dataset, unless one is already there
    migrate.ts             runs the drizzle migrations
    client.ts              the Postgres connection pool and drizzle client
  agent/
    models.ts              the model registry: request key -> Bedrock identifier
    agent.ts               builds one LangChain agent for one request
    prompt.ts              the system prompt, with today's date baked in
    answer.ts              runs one question through the agent and applies the limits
    tool-calls.ts          reads the tool calls the agent made out of its message history
    describe-error.ts      reduces an error to what is safe to log
    invalid-arguments.ts   names the fields of a tool call that do not fit the tool's schema
    logging-middleware.ts  logs every model turn and tool call; turns a failed call into a result
    tools/
      index.ts             builds the three tools
      result.ts            the shared result shape, numeric fields, the read-only transaction
      like.ts              escapes a LIKE pattern's special characters
      query-customers.ts   the query_customers tool
      query-products.ts    the query_products tool
      query-orders.ts      the query_orders tool
  server/
    app.ts                 assembles the Hono app; 404 and last-resort error handling
    routes.ts              /readyz and /query
    http-error.ts          maps an internal error to an HTTP status and code
  commands/
    ask.ts                 the script behind `make ask`
e2e/
  run.ts                   the script behind `make e2e`
  questions.ts             the five committed questions and their expected answers
  build-questions.ts       derives questions and answers from the seed data
  normalize.ts             the answer-normalization and pass-check logic
  grid.ts                  renders the pass/fail grid
scripts/
  check.sh                 the script behind `make check`
  login.sh                 the script behind `make login`
  settings.sh              reads AWS_PROFILE and AWS_REGION from the environment or .env
```

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `502 AWS_LOGIN_REQUIRED` | No session, or an expired one. On Linux, also a uid other than 1000, or Compose run with `sudo` | `make login` and try again. On Linux, see the Linux note above |
| `502 MODEL_ACCESS_DENIED` | Your AWS identity isn't allowed to call that model | `make check`, then see Model access under Prerequisites |
| `502 MODEL_UNAVAILABLE` | The model ID or profile isn't valid in the configured Region | `make check`, or switch to one of the verified Regions |
| `502 BEDROCK_ERROR` | Bedrock is throttling, overloaded, or had an internal error | Wait a few seconds and try again |
| `make up` fails because port 3000 is in use | Another program already listens on port 3000 | `APP_PORT=3001 make up` (or set it in `.env`). `make ask` and `make e2e` are unaffected; `curl` then uses port 3001 |

For a failing `make check`, the line under the failed check says what to do.

## Clean up

```bash
make down
```

stops the containers and deletes the database volume, so the next `make up`
starts from a clean database. It doesn't touch `~/.aws`: those are bind
mounts of your host files, so your AWS session survives.
