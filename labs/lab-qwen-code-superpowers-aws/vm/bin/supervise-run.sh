#!/usr/bin/env bash
# Runs one agent container and records the outcome. The host writes the
# transcript from the container's stdout, so the agent cannot edit it.
# set -u (not -e): the container's own exit code must still be captured
# and recorded in run.json, so a nonzero exit here must not abort the
# script before the final write_run_json runs.
#
# start-run.sh writes the initial run.json (status "running", startedAt,
# ...) before launching this script, so callers chaining into
# resolve-run.sh or watch.sh never race this detached process's first
# write. This script only merges further keys into that same file, and
# reads its startedAt back rather than stamping a later one, so
# durationSeconds below reflects the run's actual start, not this
# process's own start.
set -uo pipefail

run_id="$1"
# $2 is the task name, already recorded in run.json by start-run.sh.
max_turns="$3"
max_wall_time="$4"
max_rounds="$5"
run_dir="/srv/lab/runs/$run_id"

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

started_at="$(python3 -c 'import json, sys; print(json.load(open(sys.argv[1]))["startedAt"])' "$run_dir/run.json")"
started_epoch="$(date -u -d "$started_at" +%s)"

docker compose -f /srv/lab/vm/compose.yaml run --rm -T --name "run-$run_id" \
  -v "$run_dir/workspace:/workspace" \
  -e MAX_TURNS="$max_turns" -e MAX_WALL_TIME="$max_wall_time" -e MAX_ROUNDS="$max_rounds" \
  -e TODAY="$(date -u +%F)" \
  coder >"$run_dir/transcript.jsonl" 2>"$run_dir/agent.log"
exit_code=$?

write_run_json "status=str=finished" "finishedAt=str=$(date -u +%FT%TZ)" \
  "exitCode=int=$exit_code" "durationSeconds=int=$(( $(date +%s) - started_epoch ))"
