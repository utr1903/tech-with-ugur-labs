#!/usr/bin/env bash
# Prove every detection rule fires. Performs the smallest action that
# trips each rule, then waits up to 90 s for the alert to be `firing` in
# the Loki ruler. Prints a table; exit 1 if any rule did not fire.
# Needs the cluster, the tenants and the outside containers running.
set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=lib.sh
source scripts/lib.sh

RULES=(UnexpectedProcessInStorefront ServiceAccountTokenRead TenantServiceAccountApiAccess
  CrossNamespaceDbConnect BulkCustomerRead UnexpectedEgress)
TOKEN_PATH=/var/run/secrets/kubernetes.io/serviceaccount/token

loki_start

# firing_rules: print the names of the rules that currently have a firing
# alert, one per line.
firing_rules() {
  curl -fsS "http://127.0.0.1:${_LOKI_PORT}/prometheus/api/v1/rules" |
    python3 -c '
import json, sys
for g in json.load(sys.stdin)["data"]["groups"]:
    for r in g["rules"]:
        if any(a["state"] == "firing" for a in r.get("alerts", [])):
            print(r["name"])'
}
nothing_firing() { [[ -z "$(firing_rules)" ]]; }

ATTACKER_ID="$(docker compose -p ai-soc-outside ps -q attacker)"
ATTACKER_IP="$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$ATTACKER_ID")"
[[ -n "$ATTACKER_IP" ]] || {
  log error "attacker container not running; run: make outside"
  exit 1
}

# Alerts from earlier activity stay up for the 2 minute rule window; wait
# for a quiet start so every firing below was caused by this run.
log info "waiting for a quiet start"
wait_for 240 nothing_firing || {
  log error "rules still firing before the canary started"
  exit 1
}

log info "triggering all six rules" attacker_ip="$ATTACKER_IP"
# 1. a shell starts a program other than curl
kc -n storefront exec deploy/storefront -- sh -c id >/dev/null
# 2. read the service account token
kc -n storefront exec deploy/storefront -- cat "$TOKEN_PATH" >/dev/null
# 3. call the API as the storefront account and list secrets
kc -n storefront exec deploy/storefront -- sh -c \
  "curl -sk -m 10 -H \"Authorization: Bearer \$(cat $TOKEN_PATH)\" https://kubernetes.default.svc/api/v1/namespaces/payments/secrets >/dev/null"
# 4. connect to Postgres from the storefront (the login itself may fail)
kc -n storefront exec deploy/storefront -- sh -c \
  "PGCONNECT_TIMEOUT=5 PGPASSWORD=canary psql -h postgres.payments.svc -U report_reader -d payments -c 'select 1' >/dev/null 2>&1 || true"
# 5. read the whole customers table
kc -n payments exec postgres-0 -- psql -U postgres -d payments -c 'select * from customers' >/dev/null
# 6. connect to an address outside the cluster (the attacker sink)
kc -n storefront exec deploy/storefront -- curl -s -m 5 "http://${ATTACKER_IP}:8080/canary" >/dev/null || true

# Poll until all six fire or 90 s pass.
declare -A SEEN=()
deadline=$((SECONDS + 90))
while ((SECONDS < deadline)); do
  while read -r name; do
    [[ -n "$name" ]] && SEEN[$name]=yes
  done < <(firing_rules)
  all=true
  for r in "${RULES[@]}"; do [[ -n "${SEEN[$r]:-}" ]] || all=false; done
  $all && break
  sleep 3
done

failed=0
printf '%-34s %s\n' RULE FIRING
for r in "${RULES[@]}"; do
  if [[ -n "${SEEN[$r]:-}" ]]; then
    printf '%-34s yes\n' "$r"
  else
    printf '%-34s no\n' "$r"
    failed=1
  fi
done
_loki_cleanup
exit "$failed"
