#!/usr/bin/env bash
# Validates Makefile variables before any recipe line splices them into a
# shell command (the laptop's, or one sent over ssh to the VM). It reads
# each named variable from THIS PROCESS'S ENVIRONMENT (the Makefile
# exports them), never from already-interpolated command text, and checks
# it against an allow-list pattern. A value outside the pattern (spaces,
# quotes, `;`, `$(...)`, `/`, ...) is rejected here, before it ever reaches
# a command line.
set -euo pipefail

fail() {
  echo "invalid \$$1='$2' -- expected: $3" >&2
  exit 2
}

for name in "$@"; do
  case "$name" in
    TASK)
      value="${TASK:-}"
      pattern='^[a-z0-9][a-z0-9-]*$'
      label="a-z, 0-9 and dashes, e.g. log-summary"
      ;;
    RUN)
      value="${RUN:-latest}"
      pattern='^[A-Za-z0-9][A-Za-z0-9._-]*$'
      label="a run id or 'latest' (no /)"
      ;;
    TURNS)
      value="${TURNS:-150}"
      pattern='^[0-9]+$'
      label="a positive integer"
      ;;
    WALL_TIME)
      value="${WALL_TIME:-45m}"
      pattern='^[0-9]+(\.[0-9]+)?[smh]?$'
      label="a number with an optional s/m/h suffix, e.g. 45m"
      ;;
    DELAY_MS)
      value="${DELAY_MS:-15}"
      pattern='^[0-9]+$'
      label="a non-negative integer"
      ;;
    *)
      echo "check_vars.sh: unknown variable $name" >&2
      exit 2
      ;;
  esac
  [[ "$value" =~ $pattern ]] || fail "$name" "$value" "$label"
done
