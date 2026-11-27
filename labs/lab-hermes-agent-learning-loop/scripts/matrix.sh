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

# The harness stops a run that fails or overruns. As a second guard, a cell
# that did not complete gets a restarted Hermes (same home volume), so no
# leftover work can write into the next cell.
cell() {
  local name="$1"
  harness run --cell "$@"
  local dir best=0 n
  for dir in "results/runs/${name}"/r*; do
    n="${dir##*/r}"
    if [[ "${n}" =~ ^[0-9]+$ ]] && ((n > best)); then best="${n}"; fi
  done
  if ! grep -q '^  "status": "run.completed",$' "results/runs/${name}/r${best}/run.json" 2>/dev/null; then
    echo "${name} did not complete; restarting Hermes on the same home"
    docker compose up -d --wait --force-recreate hermes
  fi
}

mkdir -p results out
for repeat in $(seq 1 "${repeats}"); do
  echo "== repeat ${repeat} of ${repeats}"
  for config in full flat; do
    fresh_home "${config}" "${config}-learn"
    cell "${config}-cold" --week week-1 --home "${config}-learn" --follow-up-if-no-skill
    cell "${config}-warm" --week week-2 --home "${config}-learn"

    fresh_home "${config}" "${config}-control"
    cell "${config}-control" --week week-2 --home "${config}-control"
  done
done
