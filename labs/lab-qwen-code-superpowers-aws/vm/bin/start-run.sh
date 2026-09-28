#!/usr/bin/env bash
# Creates a run folder and starts the supervisor detached from this SSH
# session, so a dropped connection never ends a run. Prints the run id.
set -euo pipefail

task="${1:?usage: start-run.sh <task> <max-turns> <max-wall-time>}"
max_turns="${2:?}"
max_wall_time="${3:?}"
[[ "$task" =~ ^[a-z0-9][a-z0-9-]*$ ]] || { echo "Task names use a-z, 0-9 and dashes" >&2; exit 1; }
[ -f "/srv/lab/tasks/$task/task.md" ] || { echo "No task '$task' (expected tasks/$task/task.md)" >&2; exit 1; }

run_id="$task-$(date -u +%Y%m%dT%H%M%SZ)"
run_dir="/srv/lab/runs/$run_id"
mkdir -p "$run_dir/workspace"
cp "/srv/lab/tasks/$task/task.md" "$run_dir/task.md"
cp "/srv/lab/tasks/$task/task.md" "$run_dir/workspace/TASK.md"
ln -sfn "$run_id" /srv/lab/runs/latest

setsid nohup /srv/lab/vm/bin/supervise-run.sh "$run_id" "$task" "$max_turns" "$max_wall_time" \
  >"$run_dir/supervisor.log" 2>&1 < /dev/null &
echo "$run_id"
