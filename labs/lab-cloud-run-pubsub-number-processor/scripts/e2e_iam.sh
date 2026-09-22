#!/usr/bin/env bash
mint_access_token() {
  gcloud auth print-access-token --impersonate-service-account="$1" --project="$PROJECT_ID" \
    || die "Cannot impersonate $1. Arrange pre-existing account-scoped Token Creator permission; no grants are added by this verifier."
}
verify_iam() {
  local server_token processor_token push_token id_token object encoded upload object_url generation
  server_token=$(mint_access_token "$SERVER_SA")
  processor_token=$(mint_access_token "$PROCESSOR_SA")
  # Minting separately ensures impersonation errors cannot count as permission denials.
  push_token=$(mint_access_token "$PUSH_SA")
  [[ -n "$push_token" ]] || die 'Empty push token'
  id_token=$(gcloud auth print-identity-token --impersonate-service-account="$PUSH_SA" --audiences="$PROCESSOR_URL" --include-email --project="$PROJECT_ID") \
    || die "Cannot mint push ID token for $PROCESSOR_URL"
  request "$id_token" POST "$PROCESSOR_URL/" -H 'Content-Type: application/json' \
    -d '{"message":{"data":"eyJudW1iZXIiOjEwMH0=","messageId":"iam-invocation-check"}}'
  expect_status 404
  echo 'PASS: external invocation blocked even with push identity; successful Pub/Sub delivery is checked through correlated processing logs'

  # Positive publish establishes an existing, well-formed topic operation.
  request "$server_token" POST "https://pubsub.googleapis.com/v1/$TOPIC:publish" \
    -H 'Content-Type: application/json' -d '{"messages":[{"data":"eyJudW1iZXIiOjEwMH0="}]}'
  expect_status 200
  jq -e '.messageIds|length==1' "$TMP/body" >/dev/null || die 'Missing publish receipt'
  denied "$processor_token" POST "https://pubsub.googleapis.com/v1/$TOPIC:publish" pubsub.topics.publish \
    -H 'Content-Type: application/json' -d '{"messages":[{"data":"eyJudW1iZXIiOjEwMH0="}]}'

  object="iam-check-$(date +%s)-$$.txt"
  encoded=$(jq -rn --arg name "$object" '$name|@uri')
  upload="https://storage.googleapis.com/upload/storage/v1/b/$BUCKET/o?uploadType=media&name=$encoded"
  object_url="https://storage.googleapis.com/storage/v1/b/$BUCKET/o/$encoded"
  # Register cleanup BEFORE writing: even a response parse failure is recoverable.
  CLEANUP_OBJECTS+=("$object")
  request "$processor_token" POST "$upload&ifGenerationMatch=0" -H 'Content-Type: text/plain' --data-binary '101'
  expect_status 200
  generation=$(jq -er '.generation' "$TMP/body")
  # Reader confirms the exact object exists before all denied operations.
  request "$READER_TOKEN" GET "$object_url?generation=$generation"
  expect_status 200
  denied "$processor_token" GET "https://storage.googleapis.com/storage/v1/b/$BUCKET/o" storage.objects.list
  denied "$processor_token" GET "$object_url?alt=media" storage.objects.get
  denied "$processor_token" DELETE "$object_url?ifGenerationMatch=$generation" storage.objects.delete
  denied "$processor_token" POST "$upload&ifGenerationMatch=$generation" storage.objects.delete \
    -H 'Content-Type: text/plain' --data-binary '102'
  denied "$server_token" GET "https://storage.googleapis.com/storage/v1/b/$BUCKET/o" storage.objects.list
  denied "$server_token" GET "$object_url?alt=media" storage.objects.get
  denied "$server_token" DELETE "$object_url?ifGenerationMatch=$generation" storage.objects.delete
  CLEANUP_OBJECTS+=("$object-server")
  denied "$server_token" POST "$upload-server&ifGenerationMatch=0" storage.objects.create \
    -H 'Content-Type: text/plain' --data-binary '103'
  echo 'PASS: server publish and processor create; object read/list/delete/overwrite and processor publish denied'
}
cleanup_objects() {
  local original_status=$? object encoded cleanup_failed=false
  trap - EXIT
  for object in "${CLEANUP_OBJECTS[@]}"; do
    encoded=$(jq -rn --arg name "$object" '$name|@uri')
    if request "$READER_TOKEN" DELETE "https://storage.googleapis.com/storage/v1/b/$BUCKET/o/$encoded"; then
      if [[ "$HTTP_CODE" != 204 && "$HTTP_CODE" != 404 ]]; then
        echo "Cleanup failed for gs://$BUCKET/$object: HTTP $HTTP_CODE. Remove it with your reader identity." >&2
        cleanup_failed=true
      fi
    else
      echo "Cleanup request failed for gs://$BUCKET/$object. Remove it with your reader identity." >&2
      cleanup_failed=true
    fi
  done
  rm -rf "$TMP"
  if $cleanup_failed; then exit 1; fi
  exit "$original_status"
}
