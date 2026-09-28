#!/usr/bin/env bash
# One headless agent run. The task is the prompt; the only extra system
# text is today's date (open models otherwise assume their training year).
# stdout is the stream-json transcript, captured by the host supervisor.
set -euo pipefail

: "${MAX_TURNS:?}" "${MAX_WALL_TIME:?}" "${TODAY:?}"
[ -f /workspace/TASK.md ] || { echo "No /workspace/TASK.md" >&2; exit 2; }

# QWEN_HOME is tmpfs (Qwen writes lock and state files at every start);
# seed it with the settings and the extension baked into the image.
cp -a /opt/qwen-seed/. "$QWEN_HOME"/

exec qwen \
  -p "$(cat /workspace/TASK.md)" \
  --approval-mode yolo \
  --output-format stream-json \
  --include-partial-messages \
  --max-session-turns "$MAX_TURNS" \
  --max-wall-time "$MAX_WALL_TIME" \
  --append-system-prompt "Today's date is $TODAY."
