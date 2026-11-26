#!/usr/bin/env bash
# Prove the detection-to-investigation path end to end with ONE synthetic
# alert: Alertmanager -> agent -> model -> report. No attack happens and the
# alert carries a unique label so the agent's duplicate filter lets it in.
# Costs one real (small) investigation. Asserts the new report has at least
# one verdict with a valid enum value and no executed action.
# Waits up to 180 s, up to 300 s while the agent is still busy.
set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=lib.sh
source scripts/lib.sh

NONCE="$(od -An -N4 -tx1 /dev/urandom | tr -d ' \n')"
AM_PORT="$(PF_TTL=400 scripts/port-forward.sh alertmanager 9093 observability)"
AGENT_PORT="$(PF_TTL=400 scripts/port-forward.sh soc-agent 8080)"
TOKEN="$(kc -n soc get secret soc-tokens -o 'jsonpath={.data.agent-token}' | base64 -d)"

agent_get() { curl -fsS -m 20 -H "Authorization: Bearer ${TOKEN}" "http://127.0.0.1:${AGENT_PORT}$1"; }
report_ids() { agent_get /reports | python3 -c 'import json,sys; print("\n".join(sorted(r["id"] for r in json.load(sys.stdin)["reports"])))'; }

before="$(report_ids)"
NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
curl -fsS -m 20 -X POST -H 'Content-Type: application/json' \
  "http://127.0.0.1:${AM_PORT}/api/v2/alerts" \
  -d "[{\"labels\":{\"alertname\":\"LabCanary\",\"namespace\":\"storefront\",\"severity\":\"info\",\"canary\":\"${NONCE}\"},\"annotations\":{\"summary\":\"Canary alert from make up; no attack happened\"},\"startsAt\":\"${NOW}\"}]" >/dev/null
log info "posted synthetic alert" nonce="$NONCE"

# find_report: print the id of a NEW report that mentions our nonce.
find_report() {
  local id
  for id in $(comm -13 <(printf '%s\n' "$before") <(report_ids)); do
    if agent_get "/reports/${id}" | grep -q "$NONCE"; then
      echo "$id"
      return 0
    fi
  done
  return 1
}

busy() { agent_get /healthz | python3 -c 'import json,sys; sys.exit(0 if json.load(sys.stdin)["queue"] > 0 else 1)'; }

START=$SECONDS
REPORT=""
while true; do
  if REPORT="$(find_report)" && [[ -n "$REPORT" ]]; then break; fi
  elapsed=$((SECONDS - START))
  if ((elapsed >= 300)) || { ((elapsed >= 180)) && ! busy; }; then
    log error "no report within the wait" nonce="$NONCE" waited_s="$elapsed"
    exit 1
  fi
  sleep 5
done

agent_get "/reports/${REPORT}" | python3 -c '
import json, sys
r = json.load(sys.stdin)
enum = {"malicious", "benign", "inconclusive"}
verdicts = r.get("verdicts", [])
executed = [o for o in r.get("outcomes", []) if o.get("status") == "executed"]
ok = len(verdicts) >= 1 and all(v.get("verdict") in enum for v in verdicts) and not executed
print(json.dumps({
    "check": "detection-canary", "result": "ok" if ok else "fail", "report": r["id"],
    "verdicts": [v["verdict"] for v in verdicts], "executed": len(executed),
    "stopReason": r.get("stopReason"), "model": r.get("model"),
}))
sys.exit(0 if ok else 1)'
