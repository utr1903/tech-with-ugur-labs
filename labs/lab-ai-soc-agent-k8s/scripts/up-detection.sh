#!/usr/bin/env bash
# Turn on the detection layer: two Tetragon tracing policies (what the
# kernel reports) and the Loki alert rules (what counts as suspicious).
# Safe to run repeatedly.
set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=lib.sh
source scripts/lib.sh

EXPECTED_RULES=6

kc apply -f detection/tracingpolicies/ >/dev/null
log info "applied tracing policies"

kc apply -f detection/loki-rules.yaml >/dev/null
log info "applied alert rules configmap"

# The kubelet syncs the mounted ConfigMap within about a minute, then the
# ruler polls every 15 s, so wait until it reports all rules.
loki_start
rule_count() {
  curl -fsS "http://127.0.0.1:${_LOKI_PORT}/prometheus/api/v1/rules" |
    python3 -c 'import json,sys; d=json.load(sys.stdin)["data"]["groups"]; print(sum(len(g["rules"]) for g in d))'
}
rules_loaded() { [[ "$(rule_count)" == "$EXPECTED_RULES" ]]; }

if ! wait_for 180 rules_loaded; then
  log error "ruler did not load the rules" expected="$EXPECTED_RULES"
  exit 1
fi
_loki_cleanup
log info "detection ready" rules="$EXPECTED_RULES"
