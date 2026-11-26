#!/usr/bin/env bash
# Usage: soc-call.sh <agent|responder> <agent-token|responder-token|admin-token> <METHOD> <path> [json-body]
# Calls the agent or responder through a short-lived port-forward. The token
# is read from the cluster Secret into a variable and never printed.
set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=lib.sh
source scripts/lib.sh

WHO="${1:?service}"
KEY="${2:?token key}"
METHOD="${3:?method}"
URL_PATH="${4:?path}"
BODY="${5:-}"

case "$WHO" in
agent) SVC=soc-agent PORT=8080 ;;
responder) SVC=soc-responder PORT=8081 ;;
*)
  log error "unknown service" service="$WHO"
  exit 2
  ;;
esac

TOKEN="$(kc -n soc get secret soc-tokens -o "jsonpath={.data.${KEY}}" | base64 -d)"
LOCAL="$(PF_TTL=30 scripts/port-forward.sh "$SVC" "$PORT")"
# The bearer header is read from stdin (-H @-) so the token is never on argv.
args=(-fsS -m 60 -X "$METHOD" -H @-)
if [[ -n "$BODY" ]]; then
  args+=(-H "Content-Type: application/json" -d "$BODY")
fi
curl "${args[@]}" "http://127.0.0.1:${LOCAL}${URL_PATH}" <<<"Authorization: Bearer ${TOKEN}"
