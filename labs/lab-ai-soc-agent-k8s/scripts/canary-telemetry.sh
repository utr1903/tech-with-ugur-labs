#!/usr/bin/env bash
# Prove every telemetry path works end to end: do something observable in
# a throwaway pod and assert it shows up in Loki within 30 s.
#   runtime  Tetragon exec event
#   app      container stdout
#   audit    Kubernetes API audit event for the exec
#   db       Postgres statement log (only with --with-db)
# Prints one JSON line per check. Exit 0 if all pass, 1 otherwise.
set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=lib.sh
source scripts/lib.sh

WITH_DB=false
[[ "${1:-}" == "--with-db" ]] && WITH_DB=true

NS=storefront
POD=canary
IMAGE="node:22.21-bookworm-slim@sha256:25b3eb23a00590b7499f2a2ce939322727fcce1b15fdd69754fcd09536a3ae2c"
NONCE="$(od -An -N4 -tx1 /dev/urandom | tr -d ' \n')"
START=$SECONDS
FAILED=0

cleanup() {
  _loki_cleanup
  kc -n "$NS" delete pod "$POD" --ignore-not-found --wait=false >/dev/null 2>&1 || true
}
trap cleanup EXIT

# poll_loki <logql>: succeed once the query returns at least one stream
# within 30 s.
poll_loki() {
  local query="$1"
  wait_for 30 _loki_has_result "$query"
}

_loki_has_result() {
  local since=$((SECONDS - START + 10))
  loki_query "$1" "$since" |
    python3 -c 'import json,sys; sys.exit(0 if json.load(sys.stdin)["data"]["result"] else 1)'
}

check() {
  local name="$1" query="$2"
  if poll_loki "$query"; then
    printf '{"check":"%s","result":"ok","nonce":"%s"}\n' "$name" "$NONCE"
  else
    printf '{"check":"%s","result":"fail","nonce":"%s","query":%s}\n' \
      "$name" "$NONCE" "$(python3 -c 'import json,sys; print(json.dumps(sys.argv[1]))' "$query")"
    FAILED=1
  fi
}

loki_start
kc create namespace "$NS" --dry-run=client -o yaml | kc apply -f - >/dev/null
if ! { kc -n "$NS" delete pod "$POD" --ignore-not-found >/dev/null &&
  kc -n "$NS" run "$POD" --image="$IMAGE" --restart=Never --command -- sleep 3600 >/dev/null &&
  kc -n "$NS" wait --for=condition=Ready "pod/$POD" --timeout=180s >/dev/null; }; then
  printf '{"check":"setup","result":"fail","nonce":"%s"}\n' "$NONCE"
  exit 1
fi

kc -n "$NS" exec "$POD" -- sh -c "echo LAB-CANARY-EXEC-${NONCE}" >/dev/null
kc -n "$NS" exec "$POD" -- sh -c "echo LAB-CANARY-APP-${NONCE} > /proc/1/fd/1"

check runtime "{source=\"runtime\"} |= \"LAB-CANARY-EXEC-${NONCE}\""
check app "{source=\"app\", namespace=\"${NS}\"} |= \"LAB-CANARY-APP-${NONCE}\""
# The audit event names the target in requestURI/objectRef, not as "pods/exec".
check audit "{source=\"audit\"} |= \"\\\"subresource\\\":\\\"exec\\\"\" |= \"pods/${POD}/exec\" |= \"LAB-CANARY-EXEC-${NONCE}\""

if $WITH_DB; then
  kc -n payments exec postgres-0 -- psql -U postgres -c "select 'LAB-CANARY-DB-${NONCE}'" >/dev/null
  check db "{source=\"db\"} |= \"LAB-CANARY-DB-${NONCE}\""
fi

exit "$FAILED"
