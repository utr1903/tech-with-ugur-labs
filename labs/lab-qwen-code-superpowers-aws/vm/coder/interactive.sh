#!/usr/bin/env bash
# Interactive Qwen Code with the same image, settings and restrictions as
# the headless runs, in a scratch workspace. TODAY comes from vm/bin/shell.sh
# (via -e TODAY=...) so the date matches when the connection is reattached
# after the tmux session outlives midnight UTC; falls back to "now" when
# TODAY isn't set, e.g. when this is run outside that entrypoint.
set -euo pipefail
cp -a /opt/qwen-seed/. "$QWEN_HOME"/
today="${TODAY:-$(date -u +%F)}"
exec qwen --approval-mode yolo --append-system-prompt "Today's date is $today."
