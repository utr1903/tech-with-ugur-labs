# Markdown voice knowledge assistant

Ask questions about a local Markdown folder and inspect the actual retrieved sources. PostgreSQL and pgvector store the document chunks; a Next.js browser page proxies application requests to a Hono backend.

The teal robot orb changes size and contour with incoming agent audio in live mode. It never measures microphone audio or invents speech activity in simulated mode. Reduced-motion preferences keep the orb still, with readable speaking feedback.

The default **simulated transport** accepts typed questions and uses deterministic simulated embeddings and a scripted tool session. It exercises ingestion, vector retrieval, conversation routing, sources, and microphone acquisition/release. It does **not** recognize speech, synthesize speech, or perform live model inference.

## Start locally

Requirements: Docker Engine with Docker Compose, a browser, and a free localhost port 3000. Run from this lab directory:

```sh
cp .env.example .env
docker compose up --build
```

Compose automatically loads the lab root `.env` for variable interpolation. The example defaults to simulated mode and leaves the API key empty.

Open [localhost:3000](http://localhost:3000). Wait for the services to become ready, click **Start**, and allow microphone access. In simulated mode enter:

> What is the amber valve recovery code?

The fictional handbook in `tmp/documents/handbook.md` contains **ORCHID-47** in an adjacent chunk. The answer includes filenames, chunk ordinals, and source text. **Stop** releases microphone tracks, closes any voice connection, clears displayed results, and prevents a late response from entering the next session. Each Start creates a fresh backend conversation. If microphone permission is denied, grant it in browser settings and Start again. Use localhost: browsers require a secure context for microphone access.

## Edit and refresh

Markdown files in `tmp/documents` are mounted read-only into the backend. Edit or add a Markdown file on your host, then refresh:

```sh
docker compose exec frontend npm run corpus:refresh
```

The command reports added, changed, deleted, and unchanged counts as JSON logs. New or edited documents and documents with an incompatible embedding/chunking fingerprint are embedded again. Deleting a Markdown file on the host and running the same command removes its stored chunks. Startup also applies checked-in Drizzle migrations and refreshes the folder automatically. Replacements/deletions are committed atomically; a failed refresh preserves the previous corpus.

PostgreSQL data persists in `tmp/postgres` across `docker compose down` and container rebuilds. Source, dependency, and frontend build storage are separate, so source bind mounts do not replace installed dependencies. After changing a package lockfile, recreate the dependency volumes before rebuilding:

```sh
docker compose down --volumes
docker compose up --build
```

This removes named dependency/build volumes, not the PostgreSQL bind directory. To reset the corpus database, stop Compose and move `tmp/postgres` to a backup location before starting again. For example, if the destination does not already exist:

```sh
docker compose down
mv tmp/postgres tmp/postgres-backup
docker compose up --build
```

The new database is empty and the Markdown folder is ingested again. Keep the backup until you have verified any data you need. Temporary PostgreSQL, audio recordings, and browser reports are ignored by git.

**Embedding mode changes refresh automatically.** Each document stores its content hash separately from a fingerprint of the embedding provider, model or simulated algorithm version, dimensions, and chunking version/length. Startup migrates existing databases and re-embeds documents whose fingerprint is missing or differs, including simulated ↔ live switches. New vectors and fingerprints commit together; failed regeneration preserves the old corpus and prevents startup readiness. No database reset is needed for a mode switch.

## Architecture and boundaries

```text
Browser ── local HTTP ── Next.js :3000 ── internal HTTP ── Hono :3001
   │                                                      │
   │ live microphone/audio + ephemeral credential         ├─ Drizzle ─ pgvector/PostgreSQL
   └────────────────────────── OpenAI Realtime             ├─ local Markdown ingestion
                                                          └─ live OpenAI embeddings + managed Agents API
```

Only `127.0.0.1:3000` is published. The backend and PostgreSQL have no published ports. The permanent `OPENAI_API_KEY` is forwarded only to the backend; Next.js does not read or forward it to client code. Live token requests return an ephemeral Realtime secret to the browser for direct WebRTC SDP negotiation with `/v1/realtime/calls`. It is not printed by application logs or rendered in the page.

Both transports route completed `ask_knowledge_base` calls through `POST /api/agent` with a conversation ID and question. The backend uses the managed Agents API, whose separate `retrieve_documents` function performs the real local database lookup. Function outputs remain correlated by call ID. Realtime question turns force the knowledge tool; speech delivery turns disable tools and use their own answer context to avoid recursive retrieval or mixing another turn's answer. Delivery waits for the active response to finish.

The backend owns serialized, isolated conversation state: 100 sessions, 30-minute expiry, 2,000-character questions, 8 KiB JSON requests, at most four retrieval calls per turn, and a 30-second deadline including queue time. Browser token/SDP requests have 20-second deadlines and answer requests 35 seconds. Stop aborts outstanding HTTP/SDP operations and disposes partial resources; browser microphone acquisition itself cannot be cancelled, so a late acquired stream is stopped immediately. A failed knowledge request ends the browser session, releases microphone/connection resources, and directs you to **Start again** for a new conversation. The UI withholds provider error details and never automatically replays a failed paid turn.

Corpus limits: 256 KiB per Markdown file, 2 MiB aggregate, 800-character chunks, five vector hits with same-document neighbors, and 6,000 context characters. Vectors have 1,536 dimensions and are validated. Symlinks escaping the document root are rejected. Simulated word-feature embeddings and scripted abstention are only a verification approximation, and do not establish live semantic retrieval or answer quality.

In live mode microphone audio goes directly to OpenAI Realtime. Questions and retrieved excerpts go from the backend to OpenAI embeddings/managed agents. PostgreSQL retains document text/vectors locally; managed session state is held by the provider. Backend logs include user questions, document filenames and operation counts/durations. Avoid asking questions you do not want retained in local logs; document contents, API keys and ephemeral credentials are withheld. The optional live test intentionally saves transcripts, evidence and remote audio locally in `frontend/test-results`; inspect/remove those artifacts as needed. This local lab has no authentication or production deployment configuration.

## Checks

These commands run the pinned Node 24 service tooling. Start Compose first:

```sh
docker compose exec backend npm test
docker compose run --rm --no-deps -v "$PWD/frontend/src/voice:/frontend/src/voice:ro" backend npm run test:integration
docker compose run --rm --no-deps -v "$PWD/frontend/src/voice:/frontend/src/voice:ro" backend npm run typecheck
docker compose exec backend npm run lint
docker compose run --rm --no-deps -v "$PWD/frontend/src/voice:/frontend/src/voice:ro" backend npm run knip
docker compose exec frontend npm test
docker compose exec frontend npm run typecheck
docker compose exec frontend npm run lint
docker compose exec frontend npm run knip
docker compose run --rm --no-deps -v /app/.next frontend npm run build
docker compose run --build --rm browser npm run test:browser
```

The production build uses a separate temporary `.next` mount so it does not overwrite the running development build. The browser image installs Chromium and Linux dependencies through `npm run browser:install`; it uses the frontend network namespace so tests access `http://localhost:3000` with real secure-context microphone APIs and a fake device. Scripted browser checks cover readiness, real ingestion, canary/source output, track release, a fresh second conversation, safe token/relay failures and stale response suppression. Unit tests exercise overlapping starts/stops, late token/answer/connection completions, call deduplication, correlation and voice delivery sequencing.

The read-only voice-source mount is test tooling only: the backend integration test runs the browser controller and HTTP parsing against the actual Hono app/graph with a failing provider seam. It proves terminal invalidation, disposal, rejection of the old ID, and success after a fresh Start; production services have no cross-service source imports. The same mount lets backend typecheck/knip resolve those integration-test imports.

Backend integration tests reset the dedicated `voice_rag_test` schema. `TEST_DATABASE_URL` must target that test database. The supplied initialization SQL creates it on a fresh PostgreSQL directory; an older database directory may need a fresh initialization after backing up required data.

Formatting uses `npm run format` in either service. Schema generation uses `docker compose exec backend npm run db:generate`; migrations are checked in and applied on startup. Next.js lifecycle instrumentation and application operation logs use pino JSON; framework-owned startup/build output follows Next's own format.

## Optional paid live voice check

Live inference has **not been verified** for this deliverable. It requires a valid application key and actual account/model access. Managed Agents API permissions include `api.agents.read`, `api.agents.write`, and `api.responses.write`. This lab uses `openai@7.15.0` managed `client.beta.agents`, not the separate developer-managed Agents SDK. Models are `gpt-6-astra`, `gpt-realtime-2.1` with voice `marin`, and `text-embedding-3-small` (1,536 dimensions).

Edit the lab root `.env` created above: set `MODE=live` and enter your application key as `OPENAI_API_KEY`. Keep this local, ignored file private. Shell variables override Compose’s `.env` values, so clear conflicting exports. Recreate the services with the same reader entrypoint:

```sh
docker compose up --build
```

Live startup refuses a missing key. Open localhost:3000, Start, and speak the canary question. Check the returned source and hear the reply, then Stop and repeat in a fresh session. Document/account/model access errors may require backend logs; page errors deliberately withhold provider details. Provider access and speech intelligibility require actual live checks.

For an automated prerecorded canary, place your own WAV recording at `tmp/audio/question.wav`: several seconds of silence, the spoken question "What is the amber valve recovery code?", then silence. Chromium fake audio devices can loop the recording; leave enough silence to allow the answer to finish. Opt in explicitly in a shell where the live services are already running:

```sh
RUN_LIVE_CANARY=1 LIVE_AUDIO_FILE=/audio/question.wav docker compose run --build --rm browser npm run test:browser
```

The harness requires backend mode `live` and a real supplied WAV. It does not intercept/fabricate provider output. It captures completed Realtime function arguments, actual backend answer/source output, correlated returned tool results, a canary-bearing audio transcript, remote WebM audio and elapsed time, then Stops and starts a fresh second session. Query retrieval in live mode calls the actual embedding provider. Successful startup also embeds the document corpus with that provider when the stored fingerprint differs or is missing. Realtime `response.done` events contribute only observed numeric input/output/total token counts to `realtimeUsage`; an empty list means usage was unavailable, not zero.

Record actual Embeddings and managed Agents usage separately from the provider dashboard for the run’s project, models, and start/end time (include startup document embeddings and query embeddings). Save the observed token counts and any reported cost with the local canary report; account for other project traffic or use an isolated project. If Realtime completion usage is absent, record it from the dashboard too. Mark unavailable or delayed usage as pending; never infer zero or invent costs. Dashboard usage and owner audio confirmation remain manual evidence.

A passing automated canary establishes captured provider/application output, **not intelligibility**. Play back both attached session audio files and separately record the owner's confirmation that the canary reply is audible and understandable. The JSON report explicitly leaves that confirmation pending. Never report live voice verification solely from scripted tests, mocked provider tests, transcript text, or silent audio packets.

## Pins and limitations

Node **24.14.0**, PostgreSQL **17**, pgvector **0.8.2**, Next.js **16.3.5**, React/React DOM **19.3.0**, Playwright **1.63.0**, OpenAI SDK **7.15.0**, Hono **4.13.7**, Drizzle ORM **0.45.2**, and pino **10.3.1** are pinned. Docker image digests and exact npm dependencies/lockfiles are checked in. Next.js requires no local Node installation when using Compose. Real provider access, browser/network compatibility and voice quality remain opt-in checks; simulated verification incurs no API charges.
