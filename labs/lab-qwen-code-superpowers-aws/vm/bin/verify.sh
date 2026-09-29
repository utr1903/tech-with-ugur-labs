#!/usr/bin/env bash
# Checks a finished run with the verifier: workspace and hidden tests are
# mounted read-only; only verdict.json is writable.
set -euo pipefail
dir="$(/srv/lab/vm/bin/resolve-run.sh "${1:-latest}")"
task="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["task"])' "$dir/run.json")"
acceptance="/srv/lab/tasks/$task/acceptance"
: >"$dir/verdict.json"
args=(verify /run /out/verdict.json)
mounts=(-v "$dir:/run:ro" -v "$dir/verdict.json:/out/verdict.json")
if [ -d "$acceptance" ]; then
  mounts+=(-v "$acceptance:/acceptance:ro")
  args+=(--acceptance /acceptance)
fi
docker compose -f /srv/lab/vm/compose.yaml run --rm -T "${mounts[@]}" verifier "${args[@]}"
