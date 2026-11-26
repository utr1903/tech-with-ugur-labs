#!/usr/bin/env bash
# Create the secrets the SOC needs. Values are never printed.
#   soc/anthropic      api-key from ANTHROPIC_API_KEY in the lab .env
#   soc/soc-tokens     agent-token, responder-token, admin-token (random,
#                      created once and kept across re-runs)
#   observability/agent-webhook-token  copy of the agent token, which
#                      Alertmanager sends as its bearer token
set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=lib.sh
source scripts/lib.sh

if [[ ! -f .env ]]; then
  log error ".env not found: create it with one line, ANTHROPIC_API_KEY=<your key>"
  exit 1
fi
set -a
# shellcheck disable=SC1091
. ./.env
set +a
if [[ -z "${ANTHROPIC_API_KEY:-}" ]]; then
  log error "ANTHROPIC_API_KEY is empty or missing in .env"
  exit 1
fi

# The namespace must exist before its secrets do.
kc apply -f k8s/soc/namespace.yaml >/dev/null

kc -n soc create secret generic anthropic \
  --from-literal=api-key="$ANTHROPIC_API_KEY" \
  --dry-run=client -o yaml | kc apply -f - >/dev/null
unset ANTHROPIC_API_KEY
log info "applied secret" name=anthropic

if ! kc -n soc get secret soc-tokens >/dev/null 2>&1; then
  kc -n soc create secret generic soc-tokens \
    --from-literal=agent-token="$(openssl rand -hex 32)" \
    --from-literal=responder-token="$(openssl rand -hex 32)" \
    --from-literal=admin-token="$(openssl rand -hex 32)" >/dev/null
  log info "created secret" name=soc-tokens
fi

# Alertmanager needs the agent token in its own namespace. Compare first so
# a re-run does not restart Alertmanager for nothing.
secret_field() { # <ns> <name> <key>
  kc -n "$1" get secret "$2" -o "jsonpath={.data.$3}" 2>/dev/null || true
}
want="$(secret_field soc soc-tokens agent-token)"
have="$(secret_field observability agent-webhook-token token)"
if [[ "$want" != "$have" ]]; then
  kc create namespace observability --dry-run=client -o yaml | kc apply -f - >/dev/null
  kc -n observability create secret generic agent-webhook-token \
    --from-literal=token="$(printf '%s' "$want" | base64 -d)" \
    --dry-run=client -o yaml | kc apply -f - >/dev/null
  log info "updated secret" name=agent-webhook-token
  # A Secret volume refreshes slowly; restart so the new value is used now.
  if kc -n observability get sts alertmanager >/dev/null 2>&1; then
    kc -n observability rollout restart sts/alertmanager >/dev/null
    kc -n observability rollout status sts/alertmanager --timeout=180s >/dev/null
    log info "restarted alertmanager"
  fi
fi
log info "secrets ready"
