#!/usr/bin/env bash
# Renders a run's transcript live, like a coding terminal.
set -euo pipefail
dir="$(/srv/lab/vm/bin/resolve-run.sh "${1:-latest}")"
docker compose -f /srv/lab/vm/compose.yaml run --rm viewer watch "/runs/$(basename "$dir")"
