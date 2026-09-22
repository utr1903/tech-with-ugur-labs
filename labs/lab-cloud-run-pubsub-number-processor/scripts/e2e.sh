#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/common.sh"
source "$LAB_ROOT/scripts/e2e_http.sh"
source "$LAB_ROOT/scripts/e2e_policy.sh"
source "$LAB_ROOT/scripts/e2e_iam.sh"
load_config
[[ -f "$CONFIG" ]] || die 'Run make bootstrap first'
require_tools gcloud curl jq
E2E_TIMEOUT=${E2E_TIMEOUT:-180}
E2E_OBSERVE=${E2E_OBSERVE:-30}
E2E_INTERVAL=${E2E_INTERVAL:-3}
for value in "$E2E_TIMEOUT" "$E2E_OBSERVE" "$E2E_INTERVAL"; do
  [[ "$value" =~ ^[1-9][0-9]{0,2}$ ]] || die 'E2E timing values must be integer seconds in 1–999'
done
outputs=$(foundation_outputs)
BUCKET=$(jq -er '.bucket' <<< "$outputs")
TOPIC=$(jq -er '.topic' <<< "$outputs")
SERVER_SA=$(jq -er '.server_sa' <<< "$outputs")
PROCESSOR_SA=$(jq -er '.processor_sa' <<< "$outputs")
PUSH_SA=$(jq -er '.push_sa' <<< "$outputs")
[[ "$BUCKET" == "$PROJECT_ID-$LAB_NAME-results" && "$TOPIC" == "projects/$PROJECT_ID/topics/$LAB_NAME" ]] || die 'Foundation outputs differ from saved config'
for app in SERVER PROCESSOR PUSH; do
  key="${app}_SA"
  [[ "${!key}" == "$LAB_NAME-$(echo "$app" | tr '[:upper:]' '[:lower:]')@$PROJECT_ID.iam.gserviceaccount.com" ]] || die 'Identity output differs from saved config'
done
SERVER_URL=$(terraform -chdir="$LAB_ROOT/terraform/services" output -raw server_url)
PROCESSOR_URL=$(terraform -chdir="$LAB_ROOT/terraform/services" output -raw processor_url)
[[ "$SERVER_URL" =~ ^https://[a-z0-9.-]+[.]run[.]app$ && "$PROCESSOR_URL" =~ ^https://[a-z0-9.-]+[.]run[.]app$ ]] || die 'Invalid Cloud Run URL outputs'
TMP=$(mktemp -d)
CLEANUP_OBJECTS=()
READER_TOKEN=$(gcloud auth print-access-token)
trap cleanup_objects EXIT
inspect_policies
# Confirm the live resource and URL before treating HTTP 404 as network rejection.
gcloud run services describe "$LAB_NAME-processor" --region="$REGION" --project="$PROJECT_ID" --format=json > "$TMP/processor-config.json"
check_processor_config "$TMP/processor-config.json"
request '' POST "$PROCESSOR_URL/" -H 'Content-Type: application/json' -d '{"message":{"data":"eyJudW1iZXIiOjEwMH0=","messageId":"unauthenticated-check"}}'
expect_status 404
echo 'PASS: external unauthenticated processor request blocked; this is network rejection, not an IAM-denial proof'
for payload in '{}' '{"number":"101"}' '{"number":null}' '{"number":true}' '{"number":1e999}' 'broken'; do
  request '' POST "$SERVER_URL/" -H 'Content-Type: application/json' -d "$payload"
  expect_status 400
done
echo 'PASS: invalid HTTP inputs rejected. No-publication is covered by injected-publisher local tests, not inferred from these HTTP responses.'
# Milliseconds plus process ID remain exactly representable as JavaScript integers.
number=$(( $(date +%s) * 100000 + $$ % 100000 ))
request '' POST "$SERVER_URL/" -H 'Content-Type: application/json' -d "{\"number\":$number}"
expect_status 202
message_id=$(jq -er '.messageId | select(test("^[0-9]+$"))' "$TMP/body")
event=$(wait_processed "$message_id" stored)
object=$(jq -er '.object_name | select(test("^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}[.]txt$"))' <<< "$event")
CLEANUP_OBJECTS+=("$object")
request "$READER_TOKEN" GET "https://storage.googleapis.com/storage/v1/b/$BUCKET/o/$object?alt=media"
expect_status 200
[[ $(cat "$TMP/body") == "$number" ]] || die 'Correlated object content differs from sent number'
echo "PASS: message $message_id stored exact value in $object"
for number in 100 99; do
  request '' POST "$SERVER_URL/" -H 'Content-Type: application/json' -d "{\"number\":$number}"
  expect_status 202
  message_id=$(jq -er '.messageId | select(test("^[0-9]+$"))' "$TMP/body")
  observe_skipped "$message_id"
done
verify_iam
echo 'PASS: cloud checks completed for this deployment and observation window. Redelivery can create additional UUID objects; teardown removes lab bucket contents.'
