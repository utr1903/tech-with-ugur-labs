# Source-grounded URL reports with Deep Agents and Firecrawl

Give this TypeScript CLI a research instruction and public URLs. One LangChain
Deep Agent makes a task plan, reads pages through Firecrawl, selects relevant
articles from listings, and returns a cited Markdown report. The app checks its
evidence and gives it up to two repair rounds before writing the result.

OpenAI (`gpt-4.1-mini`) provides the model; Firecrawl retrieves web content.
The model has three web tools: `read_page`, `search_web`, and `crawl_site`, plus
task planning. It cannot access local files, run shell commands, or delegate to
other agents. Search snippets are candidates; only successfully read pages can
support citations. A complete result means the app's coverage checks passed;
you should still review the analysis against its cited sources.

## Set up

You need Git, Docker with Compose v2, and working OpenAI and Firecrawl API keys
with available quota. Use a Bash or Zsh terminal on Linux or macOS. Docker
Desktop must be running if you use it. The container needs outbound DNS and
HTTPS access to both APIs; it exposes no service port.

```sh
git clone https://github.com/utr1903/tech-with-ugur-labs.git
cd tech-with-ugur-labs/labs/lab-deep-agents-url-report
mkdir -p workspace/input workspace/output
chmod 1777 workspace/output
export COMPOSE_DISABLE_ENV_FILE=1
docker compose build
```

The output directory's sticky, writable mode lets container UID 1000 write on
Linux even when your host UID differs. Use this dedicated lab directory for
outputs. Input files must be readable by UID 1000.

Supply keys in the terminal without putting them in command history or copying
a secret file into the repository. These prompts work in Bash and Zsh:

```sh
printf 'OpenAI API key: '
read -r -s OPENAI_API_KEY
printf '\nFirecrawl API key: '
read -r -s FIRECRAWL_API_KEY
printf '\n'
export OPENAI_API_KEY FIRECRAWL_API_KEY
```

Compose forwards only these two API key variables. `COMPOSE_DISABLE_ENV_FILE=1`
prevents automatic `.env` loading. Keys are available to the application in its
container environment; Docker administrators can inspect that environment.
The Docker build context includes only package manifests, TypeScript build
configuration, and application source. Inputs, outputs, and secret files are
excluded from the image.

## Direct URLs

Start with no `workspace/input/urls.txt`. The following reads two public pages
on different hosts and asks for a comparison:

```sh
docker compose run --rm researcher "Compare the browser security purposes and limitations described at https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CSP and https://en.wikipedia.org/wiki/Cross-origin_resource_sharing . Summarize each page separately, cite both, and explain how CSP and CORS differ."
```

To provide URLs through a file instead, write one public HTTP(S) URL per line:

```sh
printf '%s\n' 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CSP' 'https://en.wikipedia.org/wiki/Cross-origin_resource_sharing' > workspace/input/urls.txt
chmod a+r workspace/input/urls.txt
docker compose run --rm researcher "Compare the browser security purposes and limitations in the supplied pages. Summarize each separately and cite both."
```

The CLI combines file URLs with URLs in the instruction, normalizes and
deduplicates them, and retains where each came from. Blank lines are ignored;
comments and other non-URL lines are invalid input. Every supplied valid URL
must be attempted, including URLs on unrelated hosts. Invalid entries make the
result partial instead of disappearing.

## A listing page

If you created `urls.txt`, remove it before running this example so the prior
direct pages do not join the new request:

```sh
rm -f workspace/input/urls.txt
docker compose run --rm researcher "From https://blog.mozilla.org/en/category/products/firefox/ select up to three relevant linked articles about Firefox privacy or security. Read each selected article, summarize the changes it describes, cite each article individually, and explain your selection and known omissions."
```

The agent reads the listing before selecting and reading linked articles.
Listing discovery and crawl results stay on the supplied listing's host. A
bounded crawl is optional when the listing's links are insufficient. Search
can add public external pages only when the instruction asks for discovery or
current context. The example requests a relevant selection, so a disclosed
omission need not make it partial. Asking for every article can exceed the
budget and must produce a partial result if coverage is incomplete. Public
pages can change or be unavailable to Firecrawl.

## Read the result

Each run replaces these files; copy them elsewhere before the next run if you
want to retain them. Run one researcher at a time in this directory.

| File | Contents |
| --- | --- |
| `workspace/output/report.md` | Complete/Partial status, article summaries with source links, cited themes, selection reasons, coverage, and limitations. |
| `workspace/output/coverage.json` | Machine-readable coverage, high-level plan milestones, evidence metadata, failures, omissions, and budgets. |

The CLI emits JSON log lines to stdout. Exit code **0** means complete; **1**
means partial or a fatal configuration error. Missing API keys and provider
failures produce a partial report and coverage record where possible. An empty
instruction, unreadable input, or unwritable output can fail before both files
are written; check timestamps so you do not mistake earlier outputs for a new
result. A partial report contains only summaries and themes with validated
references and explains what could not be covered.

Inspect `coverage.json` with an editor:

| Field | How to interpret it |
| --- | --- |
| `status`, `exitCode`, `reasons` | Whether the run passed coverage checks and why it is partial. |
| `requestedUrls` | Normalized input URLs, instruction/file origins (including file line numbers), and outcomes: `read`, `failed`, `denied`, `capped`, `attempted`, or `unattempted`. |
| `invalidEntries` | Input origins and rejection reasons; invalid raw values are omitted. |
| `listingPages`, `crawlPages`, `searchCandidates` | Listing evidence, validated crawl sources, and search candidates. A candidate alone is not evidence. |
| `selectedUrls` | Selected article URLs, reasons, and optional listing source IDs. |
| `sources` | Successfully read source IDs and URLs, origins (`requested`, `site-discovered`, `search-discovered`), and truncation flags. Report citation IDs map to these sources. |
| `knownOmissions`, `blockingOmissions` | Known gaps, their impact, and evidence outcomes for blocking gaps. |
| `failures`, `limitsReached` | Failed/denied operations and exhausted limits, with URLs and reasons when available. |
| `planMilestones` | Initial/revised task plans and task status; private model reasoning is excluded. |
| `limits`, `counts` | Configured budgets and recorded reads/web calls; counts include failed attempts where reserved. |

For the direct example, check both requested URLs have `outcome: "read"` and
both report citations resolve to entries in `sources`. For the listing example,
check `listingPages`, selection reasons, and separate article URLs in `sources`;
the report must cite those articles individually. Compare the JSON log operation
events with coverage. Selecting a link or finding it in search does not prove
its article was read. Coverage excludes raw page bodies, API keys, the original
instruction, and private reasoning.

## Limits, costs, and practical boundaries

| Limit | Default maximum |
| --- | --- |
| Page reads, including crawl pages | 16 |
| Web API calls, including crawl lifecycle requests | 24 |
| Pages per crawl / discovery depth | 5 / 2 |
| Characters sent to the model per page | 40,000 |
| Research run deadline | 3 minutes |
| Validation repair rounds after the initial draft | 2 |

These are application budgets, not a dollar spending cap. Model calls, large
page text, and repair rounds consume OpenAI tokens. Firecrawl search, scrape,
and crawl consume provider quota/credits; a crawl can cost more than one page
read. Failed or partial runs may still incur charges, and repeating a run adds
cost. Check your account dashboards and current
[OpenAI pricing](https://openai.com/api/pricing/) and
[Firecrawl pricing](https://www.firecrawl.dev/pricing) before running large
requests. Start with a few short pages; the lab does not enforce account billing
limits or cache results across runs.

Only public HTTP(S) URLs are accepted. Credentials in URLs, private/local
addresses, and malformed destinations are rejected. DNS checks reject names
that locally resolve to private or reserved addresses. Firecrawl subsequently
resolves and fetches pages on its infrastructure: local checks cannot pin its
DNS answers or control its redirect chain. Returned source URLs are validated,
but that does not establish where every provider-side network hop went. Treat
this as a constrained research example, not a complete network isolation system.

The 3-minute deadline bounds the app's research and evidence acceptance. The
app stops waiting and marks the result partial when time runs out; provider
requests or crawl jobs may continue remotely, and cancellation/cleanup cannot
guarantee that provider work or billing stops at the deadline. DNS/network
problems, authentication, quota, rate limits, changing pages, truncation, and
model/provider errors can all yield a partial result. Read the coverage reasons
before retrying; narrow the request when a budget blocks completion.

Source text is treated as evidence, with checks that constrain tools and
citations. Review any report before using it for security decisions. The
container runs as UID/GID 1000 with a read-only root filesystem, a 16 MiB `/tmp`
tmpfs, all Linux capabilities dropped, and no new privileges. Its only host
mounts are read-only input and writable output; it has no published ports or
Docker socket mount. Outbound API access remains enabled.

## Local development and checks

For local execution you also need Node 22 and npm. Keep the same exported keys
from setup; local execution reads the optional `urls.txt` and writes the same
output paths. Unlike Compose, it runs with your terminal user's permissions.
On native Linux, existing output files may belong to a different UID and block
the next writer. Before switching between local execution and Compose in either
direction, save any outputs you want to keep, then remove both files. The host
owner of the sticky output directory can remove either writer's files.

```sh
npm ci
rm -f workspace/output/report.md workspace/output/coverage.json
npm run dev -- "Summarize https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CSP and cite the source."
npm test
npm run typecheck
npm run lint
npm run knip
npm run build
```

Before returning to Compose, save any local outputs you want to keep, then
clear them on the host:

```sh
rm -f workspace/output/report.md workspace/output/coverage.json
docker compose build
docker compose --env-file /dev/null config --quiet
```

Tests use scripted model/Firecrawl responses without keys or paid requests.
They cover planning, direct/listing research, scope checks, repairs, budgets,
and partial results. The Compose test also needs the Docker Compose CLI and
renders a keyless configuration to check mounts, credential variable names,
and container restrictions. `config --quiet` validates without printing resolved
key values. Avoid printing the full rendered configuration when keys are set.

Clear keys from the terminal after use:

```sh
unset OPENAI_API_KEY FIRECRAWL_API_KEY
```

Background: [Deep Agents](https://docs.langchain.com/oss/javascript/deepagents/overview),
[Firecrawl](https://docs.firecrawl.dev/introduction), and
[Docker Compose service options](https://docs.docker.com/reference/compose-file/services/).
