#!/usr/bin/env bash
# Follows the agent's raw stderr log. Ctrl-C to stop.
set -euo pipefail
dir="$(/srv/lab/vm/bin/resolve-run.sh "${1:-latest}")"
tail -n 200 -F "$dir/agent.log"
