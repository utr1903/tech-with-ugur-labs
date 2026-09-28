#!/usr/bin/env bash
# Runs one agent container and records the outcome. The host writes the
# transcript from the container's stdout, so the agent cannot edit it.
set -uo pipefail

run_id="$1"; task="$2"; max_turns="$3"; max_wall_time="$4"
run_dir="/srv/lab/runs/$run_id"
SERVED_MODEL_NAME="$(sed -n 's/^SERVED_MODEL_NAME=//p' /srv/lab/vm/.env)"

write_run_json() {
  python3 - "$run_dir/run.json" "$@" <<'PY'
import json, os, sys
path, *pairs = sys.argv[1:]
data = {}
try:
    data = json.load(open(path))
except FileNotFoundError:
    pass
for pair in pairs:
    key, kind, value = pair.split("=", 2)
    data[key] = int(value) if kind == "int" else value
tmp = path + ".tmp"
json.dump(data, open(tmp, "w"), indent=2)
os.replace(tmp, path)
PY
}

started_epoch=$(date +%s)
write_run_json "runId=str=$run_id" "task=str=$task" "status=str=running" \
  "startedAt=str=$(date -u +%FT%TZ)" "maxTurns=int=$max_turns" \
  "maxWallTime=str=$max_wall_time" "model=str=$SERVED_MODEL_NAME"

docker compose -f /srv/lab/vm/compose.yaml run --rm -T --name "run-$run_id" \
  -v "$run_dir/workspace:/workspace" \
  -e MAX_TURNS="$max_turns" -e MAX_WALL_TIME="$max_wall_time" -e TODAY="$(date -u +%F)" \
  coder >"$run_dir/transcript.jsonl" 2>"$run_dir/agent.log"
exit_code=$?

write_run_json "status=str=finished" "finishedAt=str=$(date -u +%FT%TZ)" \
  "exitCode=int=$exit_code" "durationSeconds=int=$(( $(date +%s) - started_epoch ))"
