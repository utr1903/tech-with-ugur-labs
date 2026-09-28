#!/usr/bin/env bash
# Interactive Qwen Code with the same image, settings and restrictions as
# the headless runs, in a scratch workspace.
set -euo pipefail
cp -a /opt/qwen-seed/. "$QWEN_HOME"/
exec qwen --approval-mode yolo --append-system-prompt "Today's date is $(date -u +%F)."
