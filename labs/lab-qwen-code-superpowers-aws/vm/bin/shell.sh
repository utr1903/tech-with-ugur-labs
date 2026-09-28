#!/usr/bin/env bash
# Interactive Qwen Code inside tmux: reconnect with the same command after
# a dropped connection (Instance Connect sessions last at most one hour).
set -euo pipefail
mkdir -p /srv/lab/scratch
exec tmux new-session -A -s qwen \
  "docker compose -f /srv/lab/vm/compose.yaml run --rm -v /srv/lab/scratch:/workspace -e TODAY=$(date -u +%F) --entrypoint interactive.sh coder"
