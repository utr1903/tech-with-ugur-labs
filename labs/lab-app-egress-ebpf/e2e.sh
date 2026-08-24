#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

# Each container writes its output to bind mounts under ./tmp so you can inspect
# it after the stack tears down. Start every gate run from an empty tmp/ so the
# report, event stream and DNS log reflect only this run.
echo "==> Preparing a clean tmp/ for this run's output..."
rm -rf tmp
mkdir -p tmp/certs tmp/events tmp/dnslog tmp/report

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

# Removes the containers and networks; the bind-mounted output stays in ./tmp
# for inspection (see the README). Run `rm -rf tmp` to clear it.
echo "==> Tearing down (leaving ./tmp for inspection)..."
docker compose down -v
rm -f /tmp/ebpf-compose-config.json

exit "$rc"
