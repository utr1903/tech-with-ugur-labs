#!/usr/bin/env bash
# Interactive Qwen Code inside tmux: reconnect with the same command after
# a dropped connection (Instance Connect sessions last at most one hour).
# The container runs under a fixed name so that if the tmux session itself
# gets killed (instead of quitting Qwen), a fresh session can clean up the
# leftover container before starting a new one.
set -euo pipefail
mkdir -p /srv/lab/scratch
if ! tmux has-session -t qwen 2>/dev/null; then
  docker rm -f qwen-shell >/dev/null 2>&1 || true
fi
exec tmux new-session -A -s qwen \
  "docker compose -f /srv/lab/vm/compose.yaml run --rm --name qwen-shell -v /srv/lab/scratch:/workspace -e TODAY=$(date -u +%F) --entrypoint interactive.sh coder"
