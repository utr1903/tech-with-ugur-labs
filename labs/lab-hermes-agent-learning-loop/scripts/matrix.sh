#!/usr/bin/env bash
# Runs the six-cell matrix: for each config (full, flat) a learn home that
# does week 1 cold and week 2 warm, and a fresh control home that does
# week 2 with no prior learning. REPEATS=N repeats the whole block on
# freshly created homes.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${root}"
repeats="${REPEATS:-1}"

harness() { docker compose --profile tools run --rm --build harness "$@"; }

# Starts Hermes with `config` on a brand-new home volume `home`.
fresh_home() {
  local config="$1" home="$2"
  export HERMES_CONFIG="${config}" HERMES_HOME_VOLUME="twu-hermes-${home}"
  docker compose rm -sf hermes >/dev/null
  docker volume rm -f "twu-hermes-${home}" >/dev/null
  # The baseline describes one volume, so it goes with it.
  rm -f "results/${home}-baseline.json"
  docker compose up -d --wait --force-recreate hermes
  harness check --home "${home}"
}

mkdir -p results out
for repeat in $(seq 1 "${repeats}"); do
  echo "== repeat ${repeat} of ${repeats}"
  for config in full flat; do
    fresh_home "${config}" "${config}-learn"
    harness run --cell "${config}-cold" --week week-1 --home "${config}-learn" --follow-up-if-no-skill
    harness run --cell "${config}-warm" --week week-2 --home "${config}-learn"

    fresh_home "${config}" "${config}-control"
    harness run --cell "${config}-control" --week week-2 --home "${config}-control"
  done
done
