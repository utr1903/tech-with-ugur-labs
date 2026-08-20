#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

echo "==> Bringing the stack up (transparent interception + analysis)..."
docker compose up --build --abort-on-container-exit --exit-code-from analyzer

echo "==> Verifying the report against the expected egress findings..."
if docker compose run --rm --no-deps analyzer npm run verify; then
  rc=0
else
  rc=$?
fi

echo "==> Tearing down..."
docker compose down -v

exit "$rc"
