# Markdown voice knowledge assistant

A local Markdown corpus backed by PostgreSQL and pgvector. Keyless verification uses deterministic **simulated embeddings**, not live model inference. The backend and browser services are being added to this lab.

Requirements: Docker Compose and a working Docker engine. Start the local services:

```sh
docker compose up --build
```

Markdown lives in `tmp/documents`, mounted read-only into the backend. PostgreSQL data persists in `tmp/postgres`; PostgreSQL has no published port. The backend automatically applies checked-in Drizzle migrations and refreshes the corpus at startup. Only edited files are embedded again; refreshes commit replacements and deletions atomically.

Run checks against the pinned Node 24 backend container:

```sh
docker compose run --rm backend npm test
docker compose run --rm backend npm run test:integration
docker compose run --rm backend npm run typecheck
docker compose run --rm backend npm run lint
docker compose run --rm backend npm run knip
```

Integration tests use the dedicated `voice_rag_test` database and reset its schema. Keep `TEST_DATABASE_URL` pointed at that database. Existing PostgreSQL data initialized before the test database was added must be initialized with the supplied SQL separately or recreated after backing up any needed data.

Corpus defaults: 256 KiB per Markdown file, 2 MiB aggregate, 800 characters per chunk, five vector hits plus same-document neighbors, and 6,000 context characters. Symlinks escaping the document root are rejected. Sources include stable IDs, filenames, and ordinals. Simulated word-feature vectors and live `text-embedding-3-small` vectors both use 1,536 dimensions; malformed vectors are rejected.

Pinned runtime: Node 24.14.0, PostgreSQL 17 with pgvector 0.8.2. Exact npm dependency versions are recorded in `backend/package.json` and `backend/package-lock.json`. Use `npm run db:generate` to generate schema migrations; `npm run format` formats and fixes lint findings.
