#!/usr/bin/env bats
load helpers

setup() {
  setup_stubs
  LAB_STATE_DIR="$(mktemp -d)"
  export LAB_STATE_DIR AIKIDO_CLIENT_ID=cid AIKIDO_CLIENT_SECRET=csecret-XYZ
  export AIKIDO_RETRY_DELAY=0 AIKIDO_CONNECT_INTERVAL=0 AIKIDO_CONNECT_TIMEOUT=5
  # shellcheck source=../lib/aikido.sh
  source "$LIB_DIR/aikido.sh"
  stub_token
}

# A page of N filler clouds as JSON (ids 1000.., names filler-N).
filler_page() { jq -cn --argjson n "$1" '[range($n) | {id: (1000 + .), name: "filler-\(.)", provider: "aws"}]'; }

@test "token is cached" {
  aikido_token > /dev/null
  aikido_token > /dev/null
  [ "$(calls_matching '^POST /api/oauth/token')" -eq 1 ]
}

@test "token refreshes 60s before expiry" {
  _now() { echo 1000; }
  aikido_token > /dev/null
  _now() { echo 4550; }   # exp = 4600, refresh window starts at 4540
  aikido_token > /dev/null
  [ "$(calls_matching '^POST /api/oauth/token')" -eq 2 ]
}

@test "aikido_api fails on 2xx HTML body" {
  stub_response GET /api/public/v1/nope 200 '<!DOCTYPE html><html></html>'
  run aikido_api GET /nope
  [ "$status" -ne 0 ]
  [[ "$output" == *"GET /nope -> 200"* ]]
}

@test "aikido_api error output never contains the secret or token" {
  stub_response GET /api/public/v1/clouds 500 '{"reason_phrase":"boom"}'
  run aikido_api GET /clouds
  [ "$status" -ne 0 ]
  [[ "$output" != *csecret-XYZ* ]]
  [[ "$output" != *tok-SECRET-123* ]]
  [[ "$output" == *boom* ]]
}

@test "aikido_api retries 503 then succeeds" {
  stub_response GET /api/public/v1/workspace 503 '{}'
  stub_response GET /api/public/v1/workspace 200 '{"id":123456}'
  run aikido_api GET /workspace
  [ "$status" -eq 0 ]
  [ "$output" = '{"id":123456}' ]
}

@test "aikido_workspace_id prints the id" {
  stub_response GET /api/public/v1/workspace 200 '{"id":123456,"name":"example-workspace"}'
  run aikido_workspace_id
  [ "$output" = "123456" ]
}

@test "find_cloud_by_name paginates" {
  stub_response GET '/api/public/v1/clouds?page=0&per_page=100' 200 "$(filler_page 100)"
  stub_response GET '/api/public/v1/clouds?page=1&per_page=100' 200 '[{"id":77,"name":"aikido-demo-eks","provider":"aws"}]'
  run aikido_find_cloud_by_name aikido-demo-eks
  [ "$status" -eq 0 ]
  [ "$output" = "77" ]
}

@test "find_cloud_by_name prints nothing when absent" {
  stub_response GET '/api/public/v1/clouds?page=0&per_page=100' 200 '[{"id":5,"name":"test"}]'
  run aikido_find_cloud_by_name aikido-demo-aws
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "delete_cloud refuses non-demo name" {
  stub_response GET '/api/public/v1/clouds?page=0&per_page=100' 200 '[{"id":5,"name":"test"}]'
  run aikido_delete_cloud 5
  [ "$status" -ne 0 ]
  [ "$(calls_matching '^DELETE')" -eq 0 ]
}

@test "delete_cloud treats unknown id as gone" {
  stub_response GET '/api/public/v1/clouds?page=0&per_page=100' 200 '[{"id":5,"name":"test"}]'
  run aikido_delete_cloud 999
  [ "$status" -eq 0 ]
  [ "$(calls_matching '^DELETE')" -eq 0 ]
}

@test "delete_cloud deletes a demo cloud" {
  stub_response GET '/api/public/v1/clouds?page=0&per_page=100' 200 '[{"id":9,"name":"aikido-demo-aws"}]'
  stub_response DELETE /api/public/v1/clouds/9 200 '{"success":true}'
  run aikido_delete_cloud 9
  [ "$status" -eq 0 ]
  [ "$(calls_matching '^DELETE /api/public/v1/clouds/9')" -eq 1 ]
}

@test "delete_cloud treats 404 as success" {
  stub_response GET '/api/public/v1/clouds?page=0&per_page=100' 200 '[{"id":9,"name":"aikido-demo-aws"}]'
  stub_response DELETE /api/public/v1/clouds/9 404 '{"reason_phrase":"Cloud not found"}'
  run aikido_delete_cloud 9
  [ "$status" -eq 0 ]
}

@test "connect_aws retries 422 then returns id" {
  stub_response POST /api/public/v1/clouds/aws 422 '{"reason_phrase":"cannot assume role"}'
  stub_response POST /api/public/v1/clouds/aws 201 '{"id":31}'
  run aikido_connect_aws arn:aws:iam::1:role/r aikido-demo-aws
  [ "$status" -eq 0 ]
  [ "${lines[-1]}" = "31" ]
  [ "$(calls_matching '^POST /api/public/v1/clouds/aws')" -eq 2 ]
  grep -q '"environment":"production"' "$STUB_DIR/calls"
}

@test "connect_aws gives up after the timeout" {
  AIKIDO_CONNECT_TIMEOUT=0
  stub_response POST /api/public/v1/clouds/aws 422 '{"reason_phrase":"cannot assume role"}'
  run aikido_connect_aws arn:aws:iam::1:role/r aikido-demo-aws
  [ "$status" -ne 0 ]
  [[ "$output" == *"cannot assume role"* ]]
}

@test "create_k8s sends exact body" {
  stub_response POST /api/public/v1/clouds/kubernetes 200 '{"id":8,"endpoint":"https://k8s.aikido-security.com","agent_token":"agent-SECRET"}'
  run aikido_create_k8s aikido-demo-eks
  [ "$status" -eq 0 ]
  [ "$(jq -r .id <<< "$output")" = "8" ]
  sent="$(grep '^POST /api/public/v1/clouds/kubernetes' "$STUB_DIR/calls" | cut -d' ' -f3-)"
  expected='{"name":"aikido-demo-eks","environment":"production","enable_image_scanning":true,"excluded_namespaces":["kube-system","kube-public","kube-node-lease"]}'
  [ "$(jq -S . <<< "$sent")" = "$(jq -S . <<< "$expected")" ]
}

@test "find_code_repo returns the id" {
  stub_response GET '/api/public/v1/repositories/code?page=0&per_page=100' 200 '[{"id":200001,"name":"my-aikido-lab"}]'
  run aikido_find_code_repo my-aikido-lab
  [ "$output" = "200001" ]
}

@test "scan_repo posts all three scan flags" {
  stub_response POST /api/public/v1/repositories/code/200001/scan 200 '{}'
  run aikido_scan_repo 200001
  [ "$status" -eq 0 ]
  sent="$(grep '^POST /api/public/v1/repositories/code/200001/scan' "$STUB_DIR/calls" | cut -d' ' -f3-)"
  [ "$(jq -c -S . <<< "$sent")" = '{"include_iac_scan":true,"include_sast_scan":true,"include_secrets_scan":true}' ]
}

@test "decide_k8s_cloud: create when no cloud" {
  [ "$(decide_k8s_cloud "" no)" = "create" ]
  [ "$(decide_k8s_cloud "" yes)" = "create" ]
}

@test "decide_k8s_cloud: replace when cloud exists but release missing" {
  [ "$(decide_k8s_cloud 8 no)" = "replace" ]
}

@test "decide_k8s_cloud: reuse when cloud and release exist" {
  [ "$(decide_k8s_cloud 8 yes)" = "reuse" ]
}

@test "aikido curl calls carry connect and total timeouts" {
  stub_response GET /api/public/v1/workspace 200 '{"id":1}'
  aikido_workspace_id > /dev/null
  [ "$(grep -c -- '--connect-timeout' "$STUB_DIR/argv")" -eq 2 ]
  [ "$(grep -c -- '--max-time' "$STUB_DIR/argv")" -eq 2 ]
}

@test "create_k8s fails when the response lacks agent_token" {
  stub_response POST /api/public/v1/clouds/kubernetes 200 '{"id":8}'
  run aikido_create_k8s aikido-demo-eks
  [ "$status" -ne 0 ]
}

@test "create_k8s fails when the response lacks id" {
  stub_response POST /api/public/v1/clouds/kubernetes 200 '{"agent_token":"x"}'
  run aikido_create_k8s aikido-demo-eks
  [ "$status" -ne 0 ]
}

# --- GCP -----------------------------------------------------------------------
gcp_key_file() {
  KEY_FILE="$(mktemp)"
  printf '{"private_key":"PRIVATE-KEY-XYZ"}\n' > "$KEY_FILE"
}

@test "request body is not on curl argv" {
  gcp_key_file
  stub_response POST /api/public/v1/clouds/gcp 201 '{"id":1}'
  run aikido_connect_gcp aikido-demo-gcp-dev aikido-demo-dev-ab12 "$KEY_FILE" development
  [ "$status" -eq 0 ]
  ! grep -q PRIVATE-KEY-XYZ "$STUB_DIR/argv"
  grep -q PRIVATE-KEY-XYZ "$STUB_DIR/calls"
  grep -q -- '--data-binary @' "$STUB_DIR/argv"
}

@test "request removes its temp body file, also on failure" {
  gcp_key_file
  TMPDIR="$(mktemp -d)"
  export TMPDIR
  stub_response POST /api/public/v1/clouds/gcp 500 '{"reason_phrase":"boom"}'
  run aikido_api POST /clouds/gcp '{"a":"PRIVATE-KEY-XYZ"}'
  [ "$status" -ne 0 ]
  [ -z "$(ls -A "$TMPDIR")" ]
}

@test "connect_gcp sends exact body" {
  gcp_key_file
  stub_response POST /api/public/v1/clouds/gcp 201 '{"id":77}'
  run aikido_connect_gcp aikido-demo-gcp-dev aikido-demo-dev-ab12 "$KEY_FILE" development
  [ "$status" -eq 0 ]
  [ "${lines[-1]}" = "77" ]
  sent="$(grep '^POST /api/public/v1/clouds/gcp' "$STUB_DIR/calls" | cut -d' ' -f3-)"
  expected='{"name":"aikido-demo-gcp-dev","project_id":"aikido-demo-dev-ab12","access_key":"{\"private_key\":\"PRIVATE-KEY-XYZ\"}\n","environment":"development"}'
  [ "$(jq -S . <<< "$sent")" = "$(jq -S . <<< "$expected")" ]
}

@test "connect_gcp retries 400 then returns id" {
  gcp_key_file
  stub_response POST /api/public/v1/clouds/gcp 400 '{"reason_phrase":"key not valid yet"}'
  stub_response POST /api/public/v1/clouds/gcp 201 '{"id":77}'
  run aikido_connect_gcp aikido-demo-gcp-dev aikido-demo-dev-ab12 "$KEY_FILE" development
  [ "$status" -eq 0 ]
  [ "${lines[-1]}" = "77" ]
  [ "$(calls_matching '^POST /api/public/v1/clouds/gcp')" -eq 2 ]
}

@test "connect_gcp on persistent 4xx logs the status but not the response body" {
  gcp_key_file
  AIKIDO_CONNECT_TIMEOUT=0
  stub_response POST /api/public/v1/clouds/gcp 400 '{"reason_phrase":"echoed PRIVATE-KEY-XYZ"}'
  run aikido_connect_gcp aikido-demo-gcp-dev aikido-demo-dev-ab12 "$KEY_FILE" development
  [ "$status" -ne 0 ]
  [[ "$output" == *"400"* ]]
  [[ "$output" != *"PRIVATE-KEY-XYZ"* ]]
}

@test "add_gcp_registry returns registry_id" {
  gcp_key_file
  stub_response POST /api/public/v1/containers/registries/gcp-artifact-registry 201 '{"registry_id":501}'
  run aikido_add_gcp_registry aikido-demo-dev-ab12 "$KEY_FILE"
  [ "$status" -eq 0 ]
  [ "${lines[-1]}" = "501" ]
  sent="$(grep '^POST /api/public/v1/containers/registries/gcp-artifact-registry' "$STUB_DIR/calls" | cut -d' ' -f3-)"
  [ "$(jq -r .project_id <<< "$sent")" = "aikido-demo-dev-ab12" ]
  [ "$(jq -r .service_account_key <<< "$sent")" = '{"private_key":"PRIVATE-KEY-XYZ"}' ]
}

@test "registry_exists true on 200" {
  stub_response GET /api/public/v1/containers/registries/501 200 '{"registry_id":501,"registry_name":"r","username":"u","kind":"gcp"}'
  run aikido_registry_exists 501
  [ "$status" -eq 0 ]
}

@test "registry_exists false on 404" {
  stub_response GET /api/public/v1/containers/registries/501 404 '{"reason_phrase":"not found"}'
  run aikido_registry_exists 501
  [ "$status" -ne 0 ]
}

@test "registry_exists false on empty id without a call" {
  run aikido_registry_exists ""
  [ "$status" -ne 0 ]
  [ "$(calls_matching 'registries')" -eq 0 ]
}

@test "containers_in_registry filters by registry_id" {
  stub_response GET '/api/public/v1/containers?page=0&per_page=100' 200 '[{"id":1,"registry_id":501},{"id":2,"registry_id":999},{"id":3,"registry_id":501}]'
  run aikido_containers_in_registry 501
  [ "$status" -eq 0 ]
  [ "$output" = $'1\n3' ]
}

@test "mark_container calls the four endpoints in order" {
  stub_response POST /api/public/v1/containers/activate 200 '{}'
  stub_response PUT /api/public/v1/containers/9/internetConnection 200 '{}'
  stub_response PUT /api/public/v1/containers/9/sensitivity 200 '{}'
  stub_response POST /api/public/v1/containers/9/scan 200 '{}'
  run aikido_mark_container 9
  [ "$status" -eq 0 ]
  grep -E '^(POST|PUT) /api/public/v1/containers' "$STUB_DIR/calls" > "$STUB_DIR/seq"
  [ "$(sed -n 1p "$STUB_DIR/seq")" = 'POST /api/public/v1/containers/activate {"container_repo_id":9}' ]
  [ "$(sed -n 2p "$STUB_DIR/seq")" = 'PUT /api/public/v1/containers/9/internetConnection {"internet_exposed":"connected"}' ]
  [ "$(sed -n 3p "$STUB_DIR/seq")" = 'PUT /api/public/v1/containers/9/sensitivity {"sensitivity":"extreme"}' ]
  [ "$(sed -n 4p "$STUB_DIR/seq")" = 'POST /api/public/v1/containers/9/scan ' ]
}

@test "mark_container still attempts the rest after a failure" {
  stub_response POST /api/public/v1/containers/activate 200 '{}'
  stub_response PUT /api/public/v1/containers/9/internetConnection 400 '{"reason_phrase":"bad"}'
  stub_response PUT /api/public/v1/containers/9/sensitivity 200 '{}'
  stub_response POST /api/public/v1/containers/9/scan 200 '{}'
  run aikido_mark_container 9
  [ "$status" -ne 0 ]
  [ "$(calls_matching 'sensitivity|/scan')" -eq 2 ]
}

@test "aikido output never contains the key" {
  gcp_key_file
  AIKIDO_CONNECT_TIMEOUT=0
  stub_response POST /api/public/v1/clouds/gcp 500 '{"reason_phrase":"boom"}'
  run aikido_connect_gcp aikido-demo-gcp-dev aikido-demo-dev-ab12 "$KEY_FILE" development
  [ "$status" -ne 0 ]
  [[ "$output" != *PRIVATE-KEY-XYZ* ]]
}
