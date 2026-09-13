#!/usr/bin/env bash
# Unit test of request arguments only; it makes no runtime-security claim.
set -euo pipefail
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
source "$script_dir/pod-wait.sh"
requests=$(mktemp)
trap 'rm -f "$requests"' EXIT
clock_jump=true
k() {
  if builtin test "$3" = job; then
    printf 'test-job-uid\n'
  else
    printf '%s\n' "$1" >> "$requests"
    printf '{"items":[]}\n'
    return 1
  fi
}
test() {
  # Deterministically cross the deadline after the loop condition was sampled.
  if builtin test "$clock_jump" = true && builtin test "$#" -eq 3 && builtin test "$2" = -lt; then
    SECONDS=$3
    clock_jump=false
  fi
  builtin test "$@"
}
SECONDS=0
if wait_job_ready_pod test-job executor 2; then
  printf 'FAIL: expired discovery unexpectedly succeeded\n' >&2
  exit 1
fi
if builtin test -s "$requests"; then
  printf 'FAIL: request issued after deadline: %s\n' "$(cat "$requests")" >&2
  exit 1
fi
printf 'PASS: deadline crossing issues no request with disabled timeout\n'
