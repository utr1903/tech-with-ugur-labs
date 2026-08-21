#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

echo "==> Bringing the stack up (eBPF sensor + kernel-event analysis)..."
docker compose up --build --abort-on-container-exit --exit-code-from analyzer

echo "==> Dumping the resolved compose config for the zero-cooperation check..."
docker compose config --format json > /tmp/ebpf-compose-config.json

echo "==> Verifying the report and the suspect-app's zero cooperation..."
if docker compose run --rm --no-deps \
     -v /tmp/ebpf-compose-config.json:/verify/compose-config.json:ro \
     analyzer npm run verify; then
  rc=0
else
  rc=$?
fi

echo "==> Tearing down..."
docker compose down -v
rm -f /tmp/ebpf-compose-config.json

exit "$rc"
