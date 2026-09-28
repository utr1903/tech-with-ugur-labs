#!/usr/bin/env bash
# Prints the folder of a run: "latest" or empty means the newest run.
set -euo pipefail
runs=/srv/lab/runs
name="${1:-latest}"
dir="$(readlink -f "$runs/$name" 2>/dev/null || true)"
case "$dir" in
  "$runs"/*) ;;
  *) echo "No run named '$name' in $runs" >&2; exit 1 ;;
esac
[ -f "$dir/run.json" ] || { echo "No run named '$name' in $runs" >&2; exit 1; }
echo "$dir"
