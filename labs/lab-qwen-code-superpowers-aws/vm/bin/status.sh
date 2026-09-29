#!/usr/bin/env bash
# Prints a run's state: status, exit code (with what it means), duration,
# whether it has been verified, and whether its container is still there.
set -euo pipefail
dir="$(/srv/lab/vm/bin/resolve-run.sh "${1:-latest}")"
run_id="$(basename "$dir")"

python3 - "$dir/run.json" <<'PY'
import json, sys
data = json.load(open(sys.argv[1]))
print(f"run:       {data['runId']}")
print(f"task:      {data['task']}")
print(f"status:    {data['status']}")
print(f"started:   {data['startedAt']}")
exit_code = data.get("exitCode")
if exit_code is not None:
    meaning = {
        0: "ok",
        53: "turn limit",
        55: "budget",
        56: "round cap",
        130: "killed",
        137: "killed",
        143: "killed",
    }.get(exit_code, "other")
    print(f"exit code: {exit_code} ({meaning})")
duration = data.get("durationSeconds")
if duration is not None:
    print(f"duration:  {duration}s")
PY

if [ -s "$dir/verdict.json" ]; then
  echo "verdict:   present"
else
  echo "verdict:   none (run: make verify RUN=$run_id)"
fi

if [ -n "$(docker ps --filter "name=run-$run_id" -q)" ]; then
  echo "container: running"
else
  echo "container: not running"
fi
