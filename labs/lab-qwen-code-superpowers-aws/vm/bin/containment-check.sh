#!/usr/bin/env bash
# Runs the coder image's own containment check, in the same sandbox a
# real run uses, against a scratch workspace instead of a real task.
set -euo pipefail
docker compose -f /srv/lab/vm/compose.yaml run --rm -T -v /srv/lab/scratch:/workspace --entrypoint containment-check.sh coder
