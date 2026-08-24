#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

# Each container writes its output to bind mounts under ./tmp so you can inspect
# it after the stack tears down. Start every gate run from an empty tmp/ so the
# report, capture and DNS log reflect only this run.
echo "==> Preparing a clean tmp/ for this run's output..."
rm -rf tmp
mkdir -p tmp/certs tmp/capture tmp/dnslog tmp/report

echo "==> Bringing the stack up (transparent interception + analysis)..."
docker compose up --build --abort-on-container-exit --exit-code-from analyzer

echo "==> Verifying the report against the expected egress findings..."
if docker compose run --rm --no-deps analyzer npm run verify; then
  rc=0
else
  rc=$?
fi

# Removes the containers and networks; the bind-mounted output stays in ./tmp
# for inspection (see the README). Run `rm -rf tmp` to clear it.
echo "==> Tearing down (leaving ./tmp for inspection)..."
docker compose down -v

exit "$rc"
