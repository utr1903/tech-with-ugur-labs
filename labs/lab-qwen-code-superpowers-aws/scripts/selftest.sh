#!/usr/bin/env bash
# Runs the verifier on the laptop against the reference solution. Proves the
# hidden tests, the fixtures and the verifier agree before any GPU is rented.
set -euo pipefail
lab_dir="$(cd "$(dirname "$0")/.." && pwd)"
out="$(mktemp -d)"
trap 'rm -rf "$out"' EXIT
touch "$out/verdict.json"
docker build -q --target runtime -t qwen-lab/tools "$lab_dir/vm/tools" >/dev/null
docker run --rm \
  -v "$lab_dir/vm/tools/selftest/log-summary-run:/run:ro" \
  -v "$lab_dir/tasks/log-summary/acceptance:/acceptance:ro" \
  -v "$out/verdict.json:/out/verdict.json" \
  --tmpfs /scratch:exec,size=2g,mode=1777 -e SCRATCH_DIR=/scratch \
  qwen-lab/tools verify /run /out/verdict.json --acceptance /acceptance
grep -q '"verdict": "pass"' "$out/verdict.json" || { echo "Selftest failed: the reference solution did not pass." >&2; exit 1; }
echo "Selftest passed."
