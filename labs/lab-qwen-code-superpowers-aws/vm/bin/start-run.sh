#!/usr/bin/env bash
# Creates a run folder and starts the supervisor detached from this SSH
# session, so a dropped connection never ends a run. Prints the run id.
#
# run.json is written here, before the supervisor is even launched, so
# that a caller chaining straight into resolve-run.sh or watch.sh never
# races the detached supervisor's own first write.
set -euo pipefail

task="${1:?usage: start-run.sh <task> <max-turns> <max-wall-time> <max-rounds>}"
max_turns="${2:?}"
max_wall_time="${3:?}"
max_rounds="${4:?}"
[[ "$task" =~ ^[a-z0-9][a-z0-9-]*$ ]] || { echo "Task names use a-z, 0-9 and dashes" >&2; exit 1; }
[[ "$max_rounds" =~ ^[0-9]+$ ]] || { echo "max-rounds must be a positive integer" >&2; exit 1; }
[ -f "/srv/lab/tasks/$task/task.md" ] || { echo "No task '$task' (expected tasks/$task/task.md)" >&2; exit 1; }

run_id="$task-$(date -u +%Y%m%dT%H%M%SZ)"
run_dir="/srv/lab/runs/$run_id"
mkdir -p "$run_dir/workspace"
cp "/srv/lab/tasks/$task/task.md" "$run_dir/task.md"
cp "/srv/lab/tasks/$task/task.md" "$run_dir/workspace/TASK.md"
ln -sfn "$run_id" /srv/lab/runs/latest

served_model_name="$(sed -n 's/^SERVED_MODEL_NAME=//p' /srv/lab/vm/.env)"
python3 - "$run_dir/run.json" "$run_id" "$task" "$max_turns" "$max_wall_time" "$max_rounds" \
  "$served_model_name" "$(date -u +%FT%TZ)" <<'PY'
import json, os, sys
path, run_id, task, max_turns, max_wall_time, max_rounds, model, started_at = sys.argv[1:]
data = {
    "runId": run_id,
    "task": task,
    "status": "running",
    "startedAt": started_at,
    "maxTurns": int(max_turns),
    "maxWallTime": max_wall_time,
    "maxRounds": int(max_rounds),
    "model": model,
}
tmp = path + ".tmp"
json.dump(data, open(tmp, "w"), indent=2)
os.replace(tmp, path)
PY

setsid nohup /srv/lab/vm/bin/supervise-run.sh "$run_id" "$task" "$max_turns" "$max_wall_time" "$max_rounds" \
  >"$run_dir/supervisor.log" 2>&1 < /dev/null &
echo "$run_id"
