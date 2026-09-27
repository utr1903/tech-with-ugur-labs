# One agent, four models: Amazon Bedrock with LangChain in TypeScript

A small Hono service that answers plain-English questions about a seeded shop
database — customers, products, orders — by calling three typed, read-only
tools instead of writing SQL. One LangChain agent drives the whole thing, and
you pick which of four open-weight models sits behind it on every request,
with no code change. It's a good size to actually watch: every model turn and
every tool call is logged as it happens, so you can see how differently four
models handle the exact same tools and the exact same question, and where
Bedrock's tool-calling protocol leaks through the differences between them.

> Companion post: [One agent, four models: Amazon Bedrock with LangChain in TypeScript](https://techwithugur.dev/posts/bedrock-langchain-agent/)

## Prerequisites

You need on your host:

- Docker with Compose
- Make
- AWS CLI 2.32.0 or newer (`aws login` needs it)
- An AWS account with Bedrock access to all four models below, in whichever
  Region you use — request access per model in the Bedrock console if
  `make check` reports one as unreachable

Node.js is **not** needed on the host. Everything — the app, the tests, the
e2e script — runs inside the containers.

Every call this lab makes is a real call to Bedrock; there's no offline or
mocked mode. `make check` makes four tiny calls (one per model, just to
confirm you can reach it) and a full `make e2e` run makes twenty short ones
(five questions on each of the four models). Budget a few cents per run.

## Run it

```bash
make login
make up
make ask MODEL=kimi-k3 Q="How many customers live in Vienna?"
make e2e
make down
```

## What you should see

**`make login`** opens a browser tab for AWS's passwordless sign-in flow. Once
you approve it there, the terminal just returns — the session lands in
`~/.aws/login/cache` on your host, where the app will find it later.

**`make up`** first runs the same preflight as `make check`, on your host,
before touching Docker:

```
Checking profile "default" in Region "us-east-1"
  ok    AWS CLI 2.37.4
  ok    AWS config file exists
  ok    Login cache directory exists
  ok    Signed in as arn:aws:iam::<account>:user/admin
  ok    Region offers the in-Region models
  ok    Model minimax-m2.5 answers
  ok    Model nemotron-super-3 answers
  ok    Model deepseek-v3.2 answers
  ok    Model kimi-k3 answers

All checks passed.
```

That took about 9 seconds on a real run. Once it passes, Compose builds the
image and starts Postgres and the app, waiting until both report healthy —
the app runs its migrations and seeds the database before it starts listening,
so once `make up` returns, `http://127.0.0.1:3000` is ready to answer.

**`make ask`** sends one question and prints the JSON response. Here's a real
one — a different question from the quick start above, chosen because it
needs all three tools, so you can see the full shape of a response:

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

**`make e2e`** asks all five committed questions on all four models (twenty
calls), plus a handful of sanity checks, and ends with a pass/fail grid:

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

Two consecutive real runs came back 20 of 20 both times, in 1 minute 44
seconds and 1 minute 4 seconds — the variance is mostly the models, not the
lab.

**`make down`** stops the containers and deletes the database volume. Nothing
prints beyond Compose's own teardown log.

## How it works

### How sign-in reaches the container

`aws login` is the AWS CLI's browser-based sign-in: no access keys, no
long-lived secret to leak — you approve the request in your browser, and the
CLI writes a short-lived session to a cache file on your host. The app
container never gets its own credentials; it only gets to see that same
session, through two mounts:

```yaml
    volumes:
      # Read-only: the app only needs to know which login session to use.
      - type: bind
        source: ${HOME}/.aws/config
        target: /home/node/.aws/config
        read_only: true
        bind: { create_host_path: false }
      # Writable: the SDK writes refreshed 15-minute credentials back here.
      - type: bind
        source: ${HOME}/.aws/login/cache
        target: /home/node/.aws/login/cache
        bind: { create_host_path: false }
```

| What | Mounted? | Access |
| --- | --- | --- |
| `~/.aws/config` | yes | read-only |
| `~/.aws/login/cache` | yes | read and write |
| `~/.aws/credentials` | no | — |
| `~/.aws/sso/` | no | — |
| `~/.aws/cli/` | no | — |

The cache has to be writable because the credentials it holds only last 15
minutes; the AWS SDK inside the container refreshes them itself and writes
the new ones back to that same file, for up to 12 hours from the original
`aws login`, before you ever have to sign in again. This is verified, not
theoretical — a container left running for more than 15 minutes did exactly
that, and the file kept mode `600` and stayed owned by the host user
throughout.

That sharing has one limitation: don't run other `aws` commands on the same
profile while `make e2e` is running — a refresh from the container and a
write from your host CLI could race on the same file. If you do run
`make login` again while the stack is up, restart it with `make up` so the
app picks up the new session cleanly.

**Linux note (not tested on this lab's own runs, on macOS + Docker Desktop):**
on Linux the cache file is owned by your host user at mode `600`, and the
container runs as user `node` (uid 1000). If your host uid isn't 1000, the
container can't read or write the file, and the first question fails with a
502 `AWS_LOGIN_REQUIRED`. Fix it by adding a `user: "<uid>:<gid>"` entry to
the `app` service in `compose.yaml`, matching your host user.

### The dataset

The database is generated, not hand-written, from a fixed seed, so its
content is exactly reproducible:

| Table | Columns | Rows |
| --- | --- | --- |
| `customers` | id, name, email, city, country, created_at | 20 |
| `products` | id, name, category, price_cents, stock | 15 |
| `orders` | id, customer_id, product_id, quantity, status, ordered_at | 60 |

- Customers are spread across 5 cities (Munich, Vienna, Lyon, Porto, Ghent),
  one country each.
- Products fall into 4 categories (Audio, Kitchen, Outdoor, Office), assigned
  round-robin so every category has at least three products; prices run
  $4.99 to $499.99 (stored as whole cents, to avoid rounding errors), and
  stock is a globally unique number from 1 to 200 (so "lowest stock in a
  category" always has one unambiguous answer).
- Orders have quantities from 1 to 5 and one of four statuses (pending,
  shipped, delivered, cancelled).
- Every date (a customer's signup, an order's placement) falls in 2026, up
  to the fixed reference date the generator uses as "now".

The seed is `SEED` in `src/db/seed-data.ts`. Change it and the dataset
changes — which means the five committed e2e questions in `e2e/questions.ts`
no longer match. Run `npm test`: the test that compares them will fail and
print the new questions and expected answers straight from the new seed, so
you can paste them in.

### The tools

The agent never writes SQL. Instead it makes a **tool call** — a structured
request naming one of three tools and a set of arguments — and the app runs
a parameterized query on its behalf and hands the result back as a message
the model reads on its next turn.

| Tool | Filters (all optional, combined with AND) | Use it for |
| --- | --- | --- |
| `query_customers` | id, name (partial match), email, city, country, limit | a customer's id, email, city, country; counting customers |
| `query_products` | id, name (partial match), category, limit | a product's id, name, category, price, stock |
| `query_orders` | id, customer_id, product_id, status, limit | what a customer ordered, how many, its status |

Every filter builds one `WHERE` clause with drizzle-orm's own query builder
(`eq`, `ilike`, `and`) — there's no string concatenation and no way for a
model's input to become part of the SQL itself, however it's phrased. Filters
also keep the model out of the business of knowing the schema well enough to
join tables: `query_orders` returns `customer_id` and `product_id`, not
names, on purpose, so answering "what did Brionna Ebert order" takes three
chained calls (customer → orders → product) instead of one lucky guess at a
join.

Every successful call returns the same shape:

```json
{ "ok": true, "rows": [ /* up to `limit` rows */ ], "total": 1, "truncated": false }
```

`limit` defaults to 20 and caps at 100, but `total` always counts every
matching row, so a counting question is answered correctly even when the
matching rows themselves were cut off. A tool that hits a database error
returns `{ "ok": false, "error": { "code": "DATABASE_ERROR", "message": "..." } }`
instead of throwing, so one bad query doesn't end the whole request.

Every query also runs inside a read-only transaction
(`db.transaction(fn, { accessMode: "read only" })`), which makes Postgres
itself refuse a write — belt and suspenders on top of the tools only ever
using `select`.

One more thing worth knowing: numeric filters (`id`, `customer_id`, and so
on) accept a whole number sent as text, because at least one model
(DeepSeek V3.2) tends to send `"customer_id": "20"` instead of `20`. The
tools convert a string of plain digits to a number before validating it, so
that particular habit never causes a failure.

**When a tool call itself is rejected**, because its arguments don't fit the
tool's schema, the model doesn't get a thrown error — it gets a tool result
with `"code": "INVALID_ARGUMENTS"` and a message naming exactly which field
was wrong (built in `src/agent/invalid-arguments.ts`, from the same per-field
validation issues zod produces, capped at 500 characters, falling back to a
generic message if that text can't be read safely). **Any other tool
failure** — a database error, a bug — comes back with the generic
`"code": "TOOL_CALL_FAILED"` instead; the details go to the log, never to the
model. Both of these are codes inside a tool's own JSON result, read by the
model on its next turn — not HTTP status codes, and not visible in `/query`'s
response at all unless every retry the model attempts still fails. This is
handled in `src/agent/logging-middleware.ts`, which wraps every tool call
so it can log the failure and turn it into a result the model can react to,
except an abort or a timeout, which still ends the request rather than
becoming a tool result.

There's a third Compose service, `test`, behind the `test` profile — it only
runs the unit tests and has no AWS mounts, since none of them need
credentials. More on it under Tests below.

### The models

`ChatBedrockConverse` talks to every model through Bedrock's **Converse
API** — one request/response shape Bedrock translates for whichever model
you're calling, which is what lets this lab swap all four in and out behind
identical code.

| Request key | Bedrock identifier | Kind |
| --- | --- | --- |
| `minimax-m2.5` | `minimax.minimax-m2.5` | in-Region model id |
| `nemotron-super-3` | `nvidia.nemotron-super-3-120b` | in-Region model id |
| `deepseek-v3.2` | `deepseek.v3.2` | in-Region model id |
| `kimi-k3` | `global.moonshotai.kimi-k3` | global inference profile |

All four are open-weight models. Every one is called with `temperature: 0`,
except `kimi-k3`, which rejects that field outright — so for that one model
the field is simply never sent.

A plain **model id** (like `minimax.minimax-m2.5`) calls that model directly
in the Region your app is configured for; if the model isn't offered there,
the call fails. An **inference profile** (like `global.moonshotai.kimi-k3`)
is a routing identifier instead — Bedrock picks whatever Region actually has
capacity for that model, so the identifier isn't tied to the Region you set.

To add a model, add one entry to the `MODELS` object in
`src/agent/models.ts` (key, Bedrock identifier, kind, whether it takes a
temperature) and one matching `key=bedrockId` line to the `MODELS` list in
`scripts/check.sh`, which the script's own comment says to keep in sync.
Nothing else in the app needs to change.

### Regions

The app requires `AWS_REGION` to be set; `compose.yaml` defaults it to
`us-east-1` if you don't. Override it like this:

```bash
AWS_REGION=eu-west-2 make up
```

The Regions verified to offer all three in-Region models are `us-east-1`,
`us-east-2`, `us-west-2`, `eu-west-2` and `eu-north-1`. `kimi-k3`, as a
global inference profile, isn't tied to any one of them.

That's also the trade-off of a `global.` profile: Bedrock can route your
request to any Region worldwide with capacity for that model, so you don't
control, and can't guarantee, where it's actually processed — a real concern
if you care about EU data residency, say. A `us.moonshotai.kimi-k3` profile
also exists, which keeps routing inside US Regions; to use it (or an
equivalent `eu.` profile for another model), just change that entry's
`bedrockId` in `src/agent/models.ts`.

### The API

**`GET /readyz`** — returns `200 { "status": "ready" }` once migrations and
seeding are done; the server doesn't start listening before that, so a
successful response means you can ask questions.

```bash
curl -s http://127.0.0.1:3000/readyz
```

**`POST /query`** — body `{"model": "kimi-k3", "query": "..."}`; `model` is
one of the four keys above, `query` is 1 to 500 characters. A successful
response looks like the `make ask` example above: `answer` (string), `model`
(the key you sent), `toolCalls` (array of `{ name, args, ok, total }`, one
per call the agent made), `durationMs`.

```bash
curl -s http://127.0.0.1:3000/query \
  -H 'content-type: application/json' \
  -d '{"model":"kimi-k3","query":"How many customers live in Vienna?"}'
```

Errors share one shape, `{"error": {"code": "...", "message": "..."}}`:

| Status | Code | When |
| --- | --- | --- |
| 400 | `INVALID_REQUEST` | the body isn't JSON, or `model`/`query` fail validation |
| 400 | `UNKNOWN_MODEL` | `model` isn't one of the four registry keys |
| 502 | `AWS_LOGIN_REQUIRED` | AWS didn't accept the credentials |
| 502 | `MODEL_ACCESS_DENIED` | your AWS identity can't use that model |
| 502 | `MODEL_UNAVAILABLE` | Bedrock rejected the call — often, the model isn't offered in this Region |
| 502 | `BEDROCK_ERROR` | Bedrock couldn't serve the request (throttled, overloaded, its own internal error) |
| 504 | `AGENT_LIMIT_REACHED` | the agent hit its step limit without reaching an answer |
| 504 | `REQUEST_TIMEOUT` | the request passed the time limit |
| 500 | `INTERNAL_ERROR` | anything else |

Any other path answers `404` with `NOT_FOUND`.

A request may run for at most 10 model turns and 60 seconds
(`REQUEST_TIMEOUT_MS` in `src/config.ts`); either limit stops the request
with the codes above rather than letting it hang or loop.

There's no authentication on `/query`, so `compose.yaml` binds the published
port to `127.0.0.1` only — reachable from your machine, never from your
network.

### Reading the logs

```bash
make logs
```

follows the app's structured JSON logs (one line per event, via pino). Here's
a real request end to end — this one made three tool calls across four model
turns, which is why it's longer than the simplest possible request (one turn,
one tool call, one final turn):

```json
{"level":30,"time":"2026-09-27T20:46:30.825Z","appName":"shop-agent","requestId":"a2040fe2-3408-4dca-95d8-3807f075aed4","model":"deepseek-v3.2","queryLength":71,"msg":"Answering question..."}
{"level":30,"time":"2026-09-27T20:46:30.828Z","appName":"shop-agent","requestId":"a2040fe2-3408-4dca-95d8-3807f075aed4","model":"deepseek-v3.2","turn":1,"messageCount":1,"msg":"Model turn..."}
{"level":30,"time":"2026-09-27T20:46:32.721Z","appName":"shop-agent","requestId":"a2040fe2-3408-4dca-95d8-3807f075aed4","model":"deepseek-v3.2","turn":1,"durationMs":1893,"toolCallsRequested":["query_customers"],"usage":{"input_tokens":1478,"output_tokens":77,"total_tokens":1555},"msg":"Model turn succeeded."}
{"level":30,"time":"2026-09-27T20:46:32.724Z","appName":"shop-agent","requestId":"a2040fe2-3408-4dca-95d8-3807f075aed4","model":"deepseek-v3.2","tool":"query_customers","args":{"name":"Brionna Ebert"},"msg":"Tool call..."}
{"level":30,"time":"2026-09-27T20:46:32.728Z","appName":"shop-agent","requestId":"a2040fe2-3408-4dca-95d8-3807f075aed4","model":"deepseek-v3.2","tool":"query_customers","total":1,"durationMs":4,"msg":"Tool call succeeded."}
{"level":30,"time":"2026-09-27T20:46:32.730Z","appName":"shop-agent","requestId":"a2040fe2-3408-4dca-95d8-3807f075aed4","model":"deepseek-v3.2","turn":2,"messageCount":3,"msg":"Model turn..."}
{"level":30,"time":"2026-09-27T20:46:34.190Z","appName":"shop-agent","requestId":"a2040fe2-3408-4dca-95d8-3807f075aed4","model":"deepseek-v3.2","turn":2,"durationMs":1459,"toolCallsRequested":["query_orders"],"usage":{"input_tokens":1647,"output_tokens":67,"total_tokens":1714},"msg":"Model turn succeeded."}
{"level":30,"time":"2026-09-27T20:46:34.192Z","appName":"shop-agent","requestId":"a2040fe2-3408-4dca-95d8-3807f075aed4","model":"deepseek-v3.2","tool":"query_orders","args":{"customer_id":20},"msg":"Tool call..."}
{"level":30,"time":"2026-09-27T20:46:34.198Z","appName":"shop-agent","requestId":"a2040fe2-3408-4dca-95d8-3807f075aed4","model":"deepseek-v3.2","tool":"query_orders","total":1,"durationMs":6,"msg":"Tool call succeeded."}
{"level":30,"time":"2026-09-27T20:46:34.203Z","appName":"shop-agent","requestId":"a2040fe2-3408-4dca-95d8-3807f075aed4","model":"deepseek-v3.2","turn":3,"messageCount":5,"msg":"Model turn..."}
{"level":30,"time":"2026-09-27T20:46:36.627Z","appName":"shop-agent","requestId":"a2040fe2-3408-4dca-95d8-3807f075aed4","model":"deepseek-v3.2","turn":3,"durationMs":2424,"toolCallsRequested":["query_products"],"usage":{"input_tokens":1796,"output_tokens":72,"total_tokens":1868},"msg":"Model turn succeeded."}
{"level":30,"time":"2026-09-27T20:46:36.631Z","appName":"shop-agent","requestId":"a2040fe2-3408-4dca-95d8-3807f075aed4","model":"deepseek-v3.2","tool":"query_products","args":{"id":15},"msg":"Tool call..."}
{"level":30,"time":"2026-09-27T20:46:36.634Z","appName":"shop-agent","requestId":"a2040fe2-3408-4dca-95d8-3807f075aed4","model":"deepseek-v3.2","tool":"query_products","total":1,"durationMs":3,"msg":"Tool call succeeded."}
{"level":30,"time":"2026-09-27T20:46:36.635Z","appName":"shop-agent","requestId":"a2040fe2-3408-4dca-95d8-3807f075aed4","model":"deepseek-v3.2","turn":4,"messageCount":7,"msg":"Model turn..."}
{"level":30,"time":"2026-09-27T20:46:37.643Z","appName":"shop-agent","requestId":"a2040fe2-3408-4dca-95d8-3807f075aed4","model":"deepseek-v3.2","turn":4,"durationMs":1008,"toolCallsRequested":[],"usage":{"input_tokens":1942,"output_tokens":17,"total_tokens":1959},"msg":"Model turn succeeded."}
{"level":30,"time":"2026-09-27T20:46:37.645Z","appName":"shop-agent","requestId":"a2040fe2-3408-4dca-95d8-3807f075aed4","model":"deepseek-v3.2","toolCalls":3,"durationMs":6820,"msg":"Answering question succeeded."}
```

Every line carries the same `requestId`, so you can pull out one request from
a busy stream:

```bash
make logs | jq -c 'select(.requestId == "a2040fe2-3408-4dca-95d8-3807f075aed4")'
```

(a plain `grep <requestId>` works just as well if you don't have `jq`.)

### Code layout

```
src/
  index.ts                    startup order: config, logger, db, migrations, seed, tools, server, then listen
  config.ts                   parses env vars; the model-turn / timeout / output-token limits
  logger.ts                   the pino logger and the process-level error handlers
  db/
    schema.ts                 the three drizzle tables: customers, products, orders
    seed-data.ts               the deterministic fake dataset generator
    seed.ts                    inserts the generated dataset, unless one is already there
    migrate.ts                 runs the drizzle migrations
    client.ts                  the Postgres connection pool and drizzle client
  agent/
    models.ts                  the model registry: request key -> Bedrock identifier
    agent.ts                   builds one LangChain agent for one request
    prompt.ts                  the system prompt, with today's date baked in
    answer.ts                  runs one question through the agent and applies the limits
    tool-calls.ts               reads the tool calls the agent made out of its message history
    trim-answer.ts              trims whitespace some models leave around their final answer
    describe-error.ts           reduces an error down to what's safe to log
    invalid-arguments.ts        turns a rejected tool call into a message the model can act on
    logging-middleware.ts       logs every model turn and tool call, start to finish
    tools/
      index.ts                  builds the three tools
      result.ts                  the shared result shape, numeric-string handling, the read-only transaction
      like.ts                    escapes a LIKE pattern's special characters
      query-customers.ts         the query_customers tool
      query-products.ts          the query_products tool
      query-orders.ts            the query_orders tool
  server/
    app.ts                     assembles the Hono app; 404 and last-resort error handling
    routes.ts                   /readyz and /query
    http-error.ts                maps an internal error to an HTTP status and code
  commands/
    ask.ts                     the script behind `make ask`
e2e/
  run.ts                       the script behind `make e2e`
  questions.ts                  the five committed questions and their expected answers
  build-questions.ts            derives questions and answers from the seed data
  normalize.ts                  the answer-normalization and pass-check logic
  grid.ts                       renders the pass/fail grid
scripts/
  check.sh                      the script behind `make check`
```

Every file above has a matching `*.test.ts` right next to it.

### Tests

```bash
make test
```

runs the unit tests — no AWS, no network — inside the `test` Compose service
mentioned earlier, which has no AWS mounts because none of them need
credentials. They cover the tool schemas and filters, the model registry, the
HTTP error mapping, config parsing, the seed data generator, the log-line
shaping, the invalid-arguments message builder, and the e2e answer
normalization itself.

```bash
make e2e
```

runs the five committed questions against every model on the real, running
stack — twenty real Bedrock calls. A cell passes on one attempt only, no
retries, with temperature 0 wherever a model accepts it (kimi-k3 doesn't take
one at all): the response must contain every expected value once normalized
(lowercased, currency symbols and thousands separators stripped, markdown
emphasis removed), a bare number only counts if it stands alone rather than
being glued to other characters, and the response must show at least one
tool call — a right answer with no tool call still fails, since that's not
what this lab is testing.

### Make targets

| Target | Does |
| --- | --- |
| `help` | Show the available targets |
| `login` | Sign in to AWS with your browser (no access keys) |
| `check` | Verify sign-in, Region and access to all four models |
| `up` | Build and start the stack, wait until it is ready |
| `down` | Stop the stack and delete the database volume |
| `ask` | Ask one question: `make ask MODEL=kimi-k3 Q="..."` |
| `test` | Run the unit tests (no AWS needed) |
| `e2e` | Ask 5 questions on 4 models and print the result grid |
| `logs` | Follow the app's structured logs |

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `502 AWS_LOGIN_REQUIRED` | No cached session, or an expired one; on Linux, possibly a uid mismatch between your host user and the container's `node` user | `make login`, then `make up`. On Linux, if the cache file's owner uid isn't 1000, add `user: "<uid>:<gid>"` to the `app` service in `compose.yaml` |
| `502 MODEL_ACCESS_DENIED` | Your AWS identity isn't allowed to call that specific model | `make check` to see which models are reachable, then request access to the missing one in the Bedrock console |
| `502 MODEL_UNAVAILABLE` | The model id or profile isn't valid in the configured Region | `make check`, or switch to one of the verified Regions above |
| `502 BEDROCK_ERROR` | Bedrock is throttling, overloaded, or hit its own internal error | Wait a few seconds and try again |
| `make check` fails on the AWS CLI check | No AWS CLI installed, or one older than 2.32.0 | Install or upgrade the AWS CLI |
| `make check` fails on "AWS config file exists" or "Login cache directory exists" | `aws login` was never run | `make login` |
| `make check` fails on "Signed in as ..." | The cached session expired | `make login` again |
| `make check` fails on "Region offers the in-Region models" | `AWS_REGION` isn't one of the Regions with all three in-Region models | Use one of the verified Regions, or accept that `kimi-k3` still works anywhere as a global profile |
| `make check` fails on one "Model ... answers" line | Your identity lacks Bedrock access to that model in this Region | Request access to it in the Bedrock console |

## Clean up

```bash
make down
```

stops the containers and deletes the named database volume, so every seeded
row and the schema itself go with it — the next `make up` starts from a
clean database. It doesn't touch anything under `~/.aws`; that's a bind mount
into your host filesystem, not a volume, so your AWS session survives.
