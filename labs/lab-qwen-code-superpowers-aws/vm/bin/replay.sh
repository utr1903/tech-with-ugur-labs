#!/usr/bin/env bash
# Replays a finished run's transcript, paced like a live run.
set -euo pipefail
dir="$(/srv/lab/vm/bin/resolve-run.sh "${1:-latest}")"
docker compose -f /srv/lab/vm/compose.yaml run --rm viewer replay "/runs/$(basename "$dir")" --delay-ms "${2:-0}"
