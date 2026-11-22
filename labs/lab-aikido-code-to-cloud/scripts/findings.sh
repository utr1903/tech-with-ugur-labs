#!/usr/bin/env bash
# Snapshots the open Aikido issues into .state/findings-<UTC timestamp>.json and prints
# a per-type summary: issue and group counts, severities, and minutes from deploy to first detection.
# Usage: scripts/findings.sh (or: make findings)

# shellcheck source-path=SCRIPTDIR source=lib/aikido.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/aikido.sh"

# summarize_findings DEPLOYED_EPOCH: reads the export array on stdin, prints a TSV.
# first_seen_min is "-" when DEPLOYED_EPOCH is empty; negative when the finding predates the deploy.
summarize_findings() {
  jq -r --arg d "$1" '
    (["type", "issues", "groups", "critical", "high", "medium", "low", "first_seen_min"] | @tsv),
    (group_by(.type)[] as $g
      | [ $g[0].type, ($g | length), ($g | map(.group_id) | unique | length) ]
        + ([ "critical", "high", "medium", "low" ] | map(. as $s | $g | map(select(.severity == $s)) | length))
        + [ if $d == "" then "-"
            else ((($g | map(.first_detected_at) | min) - ($d | tonumber)) / 60 | floor)
            end ]
      | @tsv)'
}

main() {
  set -euo pipefail
  load_env
  require_env AIKIDO_CLIENT_ID AIKIDO_CLIENT_SECRET
  local issues deployed_at deployed_epoch="" snap
  issues="$(aikido_export_issues)" || die "could not fetch issues from Aikido"
  deployed_at="$(state_get deployed_at)"
  [[ -n "$deployed_at" ]] && deployed_epoch="$(jq -rn --arg t "$deployed_at" '$t | fromdateiso8601')"
  mkdir -p "$STATE_DIR"
  snap="$STATE_DIR/findings-$(date -u +%Y%m%dT%H%M%SZ).json"
  printf '%s\n' "$issues" > "$snap"
  echo "snapshot: $snap"
  echo "deployed_at: ${deployed_at:--}"
  summarize_findings "$deployed_epoch" <<< "$issues"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
