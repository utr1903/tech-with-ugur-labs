#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=scripts/lib.sh
source scripts/lib.sh

echo "=== Scenario 1: secrets live encrypted in git, decrypted only in the cluster ==="

echo "--> What git actually stores (sops metadata, ciphertext values):"
fleet_fresh_clone
grep -E 'sops|age|apiToken' tmp/fleet-work/apps/secret.enc.yaml | head -6

api_token="$(cat tmp/api-token)"
if grep -q "${api_token}" tmp/fleet-work/apps/secret.enc.yaml; then
  echo "FAIL: plaintext token found in the git repo"
  exit 1
fi
echo "OK: the real token appears nowhere in git"

echo "--> The cluster Secret exists (kustomize-controller decrypted it with the age key):"
kubectl -n demo get secret demo-secrets -o jsonpath='{.metadata.name}{"\n"}'

echo "--> A request without the token is rejected:"
status="$(curl -s -o /dev/null -w '%{http_code}' "${APP_URL}/api/messages")"
[[ "${status}" == "401" ]] || { echo "FAIL: expected 401, got ${status}"; exit 1; }
echo "OK: 401"

echo "--> A request with the decrypted token succeeds:"
app_get_messages | jq .

echo "=== Scenario 1 passed ==="
