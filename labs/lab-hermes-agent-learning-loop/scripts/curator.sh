#!/usr/bin/env bash
# Asks Hermes' curator what it would do with each learn home's skills
# (dry run, nothing changes) and for its status. Saves the output under
# results/curator/ and the exit codes in results/curator/exit-codes.txt.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${root}"
out="results/curator"
mkdir -p "${out}"
: >"${out}/exit-codes.txt"

# The image's version check prints this line on every CLI call; it is noise.
curator() {
  local dest="$1"
  shift
  local code=0
  docker compose exec -T -u hermes hermes hermes curator "$@" >"${dest}.raw" 2>&1 || code=$?
  grep -v 'install out of sync' "${dest}.raw" >"${dest}" || true
  rm -f "${dest}.raw"
  return "${code}"
}

for config in full flat; do
  home="${config}-learn"
  if ! docker volume inspect "twu-hermes-${home}" >/dev/null 2>&1; then
    echo "skipping ${home}: no volume twu-hermes-${home} (run make run first)"
    continue
  fi
  export HERMES_CONFIG="${config}" HERMES_HOME_VOLUME="twu-hermes-${home}"
  docker compose up -d --wait --force-recreate hermes
  dry=0
  status=0
  curator "${out}/${home}-dry-run.txt" run --dry-run || dry=$?
  curator "${out}/${home}-status.txt" status || status=$?
  echo "${home} dry-run=${dry} status=${status}" >>"${out}/exit-codes.txt"
  echo "${home}: dry-run exit ${dry}, status exit ${status}"
done
