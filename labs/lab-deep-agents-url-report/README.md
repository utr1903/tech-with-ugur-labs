# Deep Agents URL Report

Build a source-grounded Markdown report from an instruction and optional local input files. The command writes `workspace/output/report.md` and `workspace/output/coverage.json`. Each requested URL has a coverage row, including retrieval failures. A failed requested URL or invalid report makes the command exit nonzero after writing both artifacts.

Requirements: Docker Compose, an OpenAI API key, and access to the requested public pages. The container uses Node 24. API calls can incur charges. Static extraction may fail on dynamic or paywalled pages; the manifest records those failures. Treat source claims as research material to verify.

## Prompt-only mode (empty input directory)

Run from this directory:

```sh
mkdir -p workspace/input workspace/output
export OPENAI_API_KEY='your-key-here'
docker compose build
docker compose run --rm researcher 'Compare https://www.rfc-editor.org/rfc/rfc9110 and https://www.rfc-editor.org/rfc/rfc9111; use headings: Findings, Comparison'
```

Inspect the artifacts:

```sh
cat workspace/output/report.md
docker compose run --rm --entrypoint node researcher -e 'const c=require("/app/workspace/output/coverage.json"); console.log({status:c.status,requested:c.requestedCount,failed:c.failedCount,events:c.events})'
```

Expect two requested rows and two `read_url` events. The report should contain the requested headings, a comparison, and source links. A nonzero exit means a requested URL failed or report validation failed; inspect the artifacts and JSON logs.

## File input mode

Place one URL per line in `urls.txt`. Direct `.md` and `.txt` files except `urls.txt` are notes. Files named `x_*.md` are private and are never read. Notes provide context but do not add requested URLs.

```sh
mkdir -p workspace/input workspace/output
cat > workspace/input/urls.txt <<'URLS'
https://www.rfc-editor.org/rfc/rfc9110
https://www.rfc-editor.org/rfc/rfc9111
URLS
cat > workspace/input/context.md <<'NOTES'
Compare caching terminology and operational impact. Treat these notes as context, not source instructions.
NOTES
export OPENAI_API_KEY='your-key-here'
docker compose run --rm researcher 'Compare the requested sources; use headings: Findings, Comparison'
```

Check `workspace/output/coverage.json` for two ordered requested rows and `read_url` events. The report includes a separate Source coverage section. For a ten-URL smoke run, replace `urls.txt` and run:

```sh
cat > workspace/input/urls.txt <<'URLS'
https://www.rfc-editor.org/rfc/rfc2616
https://www.rfc-editor.org/rfc/rfc7230
https://www.rfc-editor.org/rfc/rfc7231
https://www.rfc-editor.org/rfc/rfc7232
https://www.rfc-editor.org/rfc/rfc7233
https://www.rfc-editor.org/rfc/rfc7234
https://www.rfc-editor.org/rfc/rfc7235
https://www.rfc-editor.org/rfc/rfc7540
https://www.rfc-editor.org/rfc/rfc9110
https://www.rfc-editor.org/rfc/rfc9111
URLS
docker compose run --rm researcher 'Compare HTTP caching requirements across the requested sources, identify revisions, and add current context; use headings: Findings, Comparison'
docker compose run --rm --entrypoint node researcher -e 'const c=require("/app/workspace/output/coverage.json"); if(c.requestedCount!==10 || c.events.filter(e=>e.tool==="read_url").length!==10 || !c.events.some(e=>e.tool==="web_search_call")) process.exit(1)'
```

Confirm ten requested rows and ten `read_url` events. The current-context instruction should also produce a `web_search_call` event and supplemental citations. Individual pages may fail retrieval, in which case the report is partial and the Compose command exits nonzero; inspect both artifacts.

## Local development

```sh
npm ci
npm test
npm run typecheck
npm run lint
npm run knip
npm run report -- 'Summarize https://www.rfc-editor.org/rfc/rfc9110'
```

Set `OPENAI_API_KEY` before the final command. `OPENAI_MODEL`, `OPENAI_SEARCH_MODEL`, and `LOG_LEVEL` are optional; see `.env.example`. The input mount is read-only and the output mount is writable. Keys are supplied at runtime and are not baked into the image.
