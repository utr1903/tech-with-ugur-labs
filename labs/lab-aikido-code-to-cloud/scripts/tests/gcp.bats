#!/usr/bin/env bats
# GCP helpers in common.sh and the GCP steps of deploy.sh, with gcloud/terraform as PATH shims.
load helpers

GCP_OUT='{"dev":{"project_id":"aikido-demo-dev-abcd","vm_ip":"10.0.0.1","bucket":"b-dev","registry":"europe-west3-docker.pkg.dev/aikido-demo-dev-abcd/aikido-demo"},"prod":{"project_id":"aikido-demo-prod-efgh","vm_ip":"10.0.0.2","bucket":"b-prod","registry":"europe-west3-docker.pkg.dev/aikido-demo-prod-efgh/aikido-demo"}}'

setup() {
  setup_stubs
  LAB_STATE_DIR="$(mktemp -d)"
  GCP_TMP="$(mktemp -d)"
  export LAB_STATE_DIR GCP_TMP AIKIDO_CLIENT_ID=cid AIKIDO_CLIENT_SECRET=csecret-XYZ
  export AIKIDO_RETRY_DELAY=0 AIKIDO_CONNECT_INTERVAL=0 AIKIDO_CONNECT_TIMEOUT=5
  export GCP_CONTAINER_POLL_TRIES=1 GCP_CONTAINER_POLL_DELAY=0
  : > "$STUB_DIR/gcloud.calls"

  # gcloud shim: logs argv; the account and the org policy grep result come from env vars.
  cat > "$STUB_DIR/bin/gcloud" << 'STUB'
#!/usr/bin/env bash
echo "$*" >> "$STUB_DIR/gcloud.calls"
case "$1 $2" in
  "auth application-default") [[ "${GCLOUD_ADC_OK:-1}" == 1 ]] && echo ya29.fake || exit 1 ;;
  "config get-value") echo "${GCLOUD_ACCOUNT:-me@example.com}" ;;
  "organizations get-iam-policy") printf '%s' "${GCLOUD_POLICY_OUT:-}" ;;
  "projects list") [[ "${GCLOUD_PROJECTS_FAIL:-0}" == 1 ]] && exit 1; printf '%s' "${GCLOUD_PROJECTS_OUT:-}" ;;
esac
exit 0
STUB
  # terraform shim: serves `output -json gcp` and `output -json gcp_aikido_keys`.
  cat > "$STUB_DIR/bin/terraform" << 'STUB'
#!/usr/bin/env bash
echo "$*" >> "$STUB_DIR/terraform.calls"
case "$*" in *" init "* | *" destroy "*) exit "${TF_RC:-0}" ;; esac
case "${*: -1}" in
  gcp) printf '%s\n' "$TF_GCP_OUT" ;;
  gcp_aikido_keys) printf '%s\n' "$TF_GCP_KEYS_OUT" ;;
  *) exit 1 ;;
esac
STUB
  chmod +x "$STUB_DIR/bin/gcloud" "$STUB_DIR/bin/terraform"
  key() { printf '{"type":"service_account","private_key":"KEY-SECRET-%s"}' "$1" | base64 | tr -d '\n'; }
  TF_GCP_OUT="$GCP_OUT"
  TF_GCP_KEYS_OUT="$(jq -cn --arg a "$(key dev-cspm)" --arg b "$(key dev-reg)" --arg c "$(key prod-cspm)" --arg d "$(key prod-reg)" \
    '{dev: {cspm: $a, registry: $b}, prod: {cspm: $c, registry: $d}}')"
  export TF_GCP_OUT TF_GCP_KEYS_OUT
}

load_deploy() {
  # shellcheck source=../deploy.sh
  source "$BATS_TEST_DIRNAME/../deploy.sh"
  set +u
  stub_token
}

@test "gcp_aikido_env maps dev and prod" {
  source "$LIB_DIR/common.sh"
  [ "$(gcp_aikido_env dev)" = "development" ]
  [ "$(gcp_aikido_env prod)" = "production" ]
  run gcp_aikido_env staging
  [ "$status" -ne 0 ]
}

@test "gcp_envs prints dev prod" {
  source "$LIB_DIR/common.sh"
  [ "$(gcp_envs)" = "dev prod" ]
}

@test "tf_output_json reads a JSON output" {
  source "$LIB_DIR/common.sh"
  [ "$(tf_output_json gcp | jq -r .dev.bucket)" = "b-dev" ]
  grep -q -- "output -json gcp" "$STUB_DIR/terraform.calls"
}

use_tfvars() {
  INFRA_DIR="$GCP_TMP/infra"
  mkdir -p "$INFRA_DIR"
  printf 'gcp_org_id = "123456789012"\ngcp_billing_account = "000000-AAAAAA-000000"\n' > "$INFRA_DIR/terraform.tfvars"
}

@test "gcp_preflight fails with the grant command when the role is missing" {
  source "$LIB_DIR/common.sh"
  use_tfvars
  GCLOUD_POLICY_OUT=""
  export GCLOUD_POLICY_OUT
  run gcp_preflight
  [ "$status" -ne 0 ]
  [[ "$output" == *"gcloud organizations add-iam-policy-binding 123456789012"* ]]
  [[ "$output" == *"--member=user:me@example.com"* ]]
  [[ "$output" == *"--role=roles/orgpolicy.policyAdmin"* ]]
  ! grep -q add-iam-policy-binding "$STUB_DIR/gcloud.calls"
}

@test "gcp_preflight passes when the binding is listed" {
  source "$LIB_DIR/common.sh"
  use_tfvars
  GCLOUD_POLICY_OUT="roles/orgpolicy.policyAdmin"
  export GCLOUD_POLICY_OUT
  run gcp_preflight
  [ "$status" -eq 0 ]
  grep -q "organizations get-iam-policy 123456789012" "$STUB_DIR/gcloud.calls"
  grep -q "roles/orgpolicy.policyAdmin" "$STUB_DIR/gcloud.calls"
}

@test "gcp_preflight reads the organization from terraform.tfvars" {
  source "$LIB_DIR/common.sh"
  INFRA_DIR="$GCP_TMP/infra"
  mkdir -p "$INFRA_DIR"
  printf '# org\ngcp_org_id   =   "987654321098"   # mine\n' > "$INFRA_DIR/terraform.tfvars"
  GCLOUD_POLICY_OUT="roles/orgpolicy.policyAdmin"
  export GCLOUD_POLICY_OUT
  run gcp_preflight
  [ "$status" -eq 0 ]
  grep -q "organizations get-iam-policy 987654321098" "$STUB_DIR/gcloud.calls"
}

@test "gcp_preflight fails when terraform.tfvars has no gcp_org_id" {
  source "$LIB_DIR/common.sh"
  INFRA_DIR="$GCP_TMP/infra"
  mkdir -p "$INFRA_DIR"
  printf 'gcp_billing_account = "000000-AAAAAA-000000"\n' > "$INFRA_DIR/terraform.tfvars"
  run gcp_preflight
  [ "$status" -ne 0 ]
  [[ "$output" == *"gcp_org_id"* ]]
}

@test "gcp_preflight fails without application-default credentials" {
  source "$LIB_DIR/common.sh"
  GCLOUD_ADC_OK=0
  export GCLOUD_ADC_OK
  run gcp_preflight
  [ "$status" -ne 0 ]
  [[ "$output" == *"gcloud auth application-default login"* ]]
}

@test "deploy.sh can be sourced without running main" {
  run bash -c "source '$BATS_TEST_DIRNAME/../deploy.sh' && type step_aikido_gcp > /dev/null && echo sourced"
  [ "$status" -eq 0 ]
  [ "${lines[-1]}" = "sourced" ]
}

@test "step_aikido_gcp reuses state ids" {
  load_deploy
  GCP_JSON="$GCP_OUT"
  state_set gcp_dev_cloud_id 501
  state_set gcp_prod_cloud_id 502
  state_set gcp_dev_registry_id 601
  state_set gcp_prod_registry_id 602
  stub_response GET '/api/public/v1/clouds?page=0&per_page=100' 200 \
    '[{"id":501,"name":"aikido-demo-gcp-dev"},{"id":502,"name":"aikido-demo-gcp-prod"}]'
  stub_response GET /api/public/v1/containers/registries/601 200 '{"id":601}'
  stub_response GET /api/public/v1/containers/registries/602 200 '{"id":602}'
  stub_response GET '/api/public/v1/containers?page=0&per_page=100' 200 '[{"id":71,"registry_id":601},{"id":72,"registry_id":602}]'
  for id in 71 72; do
    stub_response POST /api/public/v1/containers/activate 200 '{}'
    stub_response PUT "/api/public/v1/containers/$id/internetConnection" 200 '{}'
    stub_response PUT "/api/public/v1/containers/$id/sensitivity" 200 '{}'
    stub_response POST "/api/public/v1/containers/$id/scan" 200 '{}'
  done
  run step_aikido_gcp
  [ "$status" -eq 0 ]
  [ "$(calls_matching '^POST /api/public/v1/clouds/gcp')" -eq 0 ]
  [ "$(calls_matching '^POST .*gcp-artifact-registry')" -eq 0 ]
  [ "$(calls_matching '^POST /api/public/v1/containers/71/scan')" -eq 1 ]
  [ "$(calls_matching '^POST /api/public/v1/containers/72/scan')" -eq 1 ]
  [ "$(state_get gcp_dev_cloud_id)" = "501" ]
  [ "$(state_get gcp_prod_registry_id)" = "602" ]
}

@test "step_aikido_gcp connects missing envs with the right environment" {
  load_deploy
  GCP_JSON="$GCP_OUT"
  stub_response GET '/api/public/v1/clouds?page=0&per_page=100' 200 '[]'
  stub_response POST /api/public/v1/clouds/gcp 201 '{"id":801}'
  stub_response POST /api/public/v1/clouds/gcp 201 '{"id":802}'
  stub_response POST /api/public/v1/containers/registries/gcp-artifact-registry 200 '{"registry_id":901}'
  stub_response POST /api/public/v1/containers/registries/gcp-artifact-registry 200 '{"registry_id":902}'
  stub_response GET '/api/public/v1/containers?page=0&per_page=100' 200 '[]'
  run step_aikido_gcp
  [ "$status" -eq 0 ]
  dev="$(grep '^POST /api/public/v1/clouds/gcp' "$STUB_DIR/calls" | sed -n 1p | cut -d' ' -f3-)"
  prod="$(grep '^POST /api/public/v1/clouds/gcp' "$STUB_DIR/calls" | sed -n 2p | cut -d' ' -f3-)"
  [ "$(jq -r .environment <<< "$dev")" = "development" ]
  [ "$(jq -r .name <<< "$dev")" = "aikido-demo-gcp-dev" ]
  [ "$(jq -r .project_id <<< "$dev")" = "aikido-demo-dev-abcd" ]
  [[ "$(jq -r .access_key <<< "$dev")" == *KEY-SECRET-dev-cspm* ]]
  [ "$(jq -r .environment <<< "$prod")" = "production" ]
  [ "$(jq -r .name <<< "$prod")" = "aikido-demo-gcp-prod" ]
  reg="$(grep 'gcp-artifact-registry' "$STUB_DIR/calls" | sed -n 2p | cut -d' ' -f3-)"
  [[ "$(jq -r .service_account_key <<< "$reg")" == *KEY-SECRET-prod-reg* ]]
  [ "$(state_get gcp_dev_cloud_id)" = "801" ]
  [ "$(state_get gcp_prod_cloud_id)" = "802" ]
  [ "$(state_get gcp_dev_registry_id)" = "901" ]
  [ "$(state_get gcp_prod_registry_id)" = "902" ]
  # Keys never reach argv or the step's output.
  ! grep -q KEY-SECRET "$STUB_DIR/argv"
  [[ "$output" != *KEY-SECRET* ]]
  # Decoded keys are removed once used.
  [ -z "$(ls -A "$GCP_TMP/keys")" ]
}

@test "step_aikido_gcp warns but continues when container marking fails" {
  load_deploy
  GCP_JSON="$GCP_OUT"
  state_set gcp_dev_cloud_id 501
  state_set gcp_prod_cloud_id 502
  state_set gcp_dev_registry_id 601
  state_set gcp_prod_registry_id 602
  stub_response GET '/api/public/v1/clouds?page=0&per_page=100' 200 \
    '[{"id":501,"name":"aikido-demo-gcp-dev"},{"id":502,"name":"aikido-demo-gcp-prod"}]'
  stub_response GET /api/public/v1/containers/registries/601 200 '{"id":601}'
  stub_response GET /api/public/v1/containers/registries/602 200 '{"id":602}'
  stub_response GET '/api/public/v1/containers?page=0&per_page=100' 200 '[{"id":71,"registry_id":601}]'
  run step_aikido_gcp
  [ "$status" -eq 0 ]
  [[ "$output" == *"[warn]"*"container 71"* ]]
}

@test "step_gcp_health warns and continues on timeout" {
  load_deploy
  GCP_JSON="$GCP_OUT"
  GCP_HEALTH_TRIES=1 GCP_HEALTH_DELAY=0
  # curl stub prints no status and exits 0 for unknown paths, so make healthz fail via a shim.
  printf '#!/usr/bin/env bash\nexit 22\n' > "$STUB_DIR/bin/curl"
  run step_gcp_health
  [ "$status" -eq 0 ]
  [[ "$output" == *"[warn]"*"10.0.0.1:8080"* ]]
  [[ "$output" == *"[warn]"*"10.0.0.2:8080"* ]]
}

@test "step_gcp_image builds once and tags both registries" {
  load_deploy
  GCP_JSON="$GCP_OUT"
  IMAGE_TAG=abc123
  printf '#!/usr/bin/env bash\necho "$*" >> "$STUB_DIR/docker.calls"\n' > "$STUB_DIR/bin/docker"
  chmod +x "$STUB_DIR/bin/docker"
  run step_gcp_image
  [ "$status" -eq 0 ]
  grep -q "auth configure-docker europe-west3-docker.pkg.dev --quiet" "$STUB_DIR/gcloud.calls"
  [ "$(wc -l < "$STUB_DIR/docker.calls")" -eq 1 ]
  call="$(cat "$STUB_DIR/docker.calls")"
  [[ "$call" == "buildx build --platform linux/amd64 --push "* ]]
  for r in aikido-demo-dev-abcd aikido-demo-prod-efgh; do
    [[ "$call" == *"-t europe-west3-docker.pkg.dev/$r/aikido-demo/files-app:abc123"* ]]
    [[ "$call" == *"-t europe-west3-docker.pkg.dev/$r/aikido-demo/files-app:latest"* ]]
  done
  [[ "$call" == *"/apps/gcp-files" ]] && [[ "$call" != *"demo/apps"* ]]
}

@test "step_gcp_image is skipped with --skip-image" {
  load_deploy
  GCP_JSON="$GCP_OUT"
  SKIP_IMAGE=1
  printf '#!/usr/bin/env bash\necho "$*" >> "$STUB_DIR/docker.calls"\n' > "$STUB_DIR/bin/docker"
  chmod +x "$STUB_DIR/bin/docker"
  run step_gcp_image
  [ "$status" -eq 0 ]
  [ ! -f "$STUB_DIR/docker.calls" ]
  [ ! -s "$STUB_DIR/gcloud.calls" ]
}

@test "step_gcp_seed exports per env and uploads private and public files" {
  load_deploy
  GCP_JSON="$GCP_OUT"
  SERVER_DIR="$(mktemp -d)"
  mkdir -p "$SERVER_DIR/node_modules"
  cat > "$STUB_DIR/bin/npm" << 'STUB'
#!/usr/bin/env bash
echo "$*" >> "$STUB_DIR/npm.calls"
while [[ $# -gt 0 ]]; do [[ "$1" == --out ]] && { mkdir -p "$2/customers" && echo x > "$2/customers/a.json"; }; shift; done
STUB
  chmod +x "$STUB_DIR/bin/npm"
  run step_gcp_seed
  [ "$status" -eq 0 ]
  grep -q -- "run --silent export -- --out $GCP_TMP/dev --seed 42$" "$STUB_DIR/npm.calls"
  grep -q -- "run --silent export -- --out $GCP_TMP/prod --seed 4242$" "$STUB_DIR/npm.calls"
  grep -q "storage cp -r $GCP_TMP/dev/customers gs://b-dev/private/" "$STUB_DIR/gcloud.calls"
  grep -q "storage cp -r $GCP_TMP/prod/customers gs://b-prod/private/" "$STUB_DIR/gcloud.calls"
  grep -q "gs://b-dev/public/readme.txt" "$STUB_DIR/gcloud.calls"
  grep -q "gs://b-prod/public/welcome.txt" "$STUB_DIR/gcloud.calls"
}

@test "step_gcp_seed is skipped with --skip-seed" {
  load_deploy
  GCP_JSON="$GCP_OUT"
  SKIP_SEED=1
  run step_gcp_seed
  [ "$status" -eq 0 ]
  [ ! -s "$STUB_DIR/gcloud.calls" ]
}

load_destroy() {
  # shellcheck source=../destroy.sh
  source "$BATS_TEST_DIRNAME/../destroy.sh"
  set +u
  stub_token
}

CLOUDS_URL='/api/public/v1/clouds?page=0&per_page=100'

@test "destroy deletes GCP clouds by state and by name" {
  load_destroy
  state_set gcp_dev_cloud_id 501
  stub_response GET "$CLOUDS_URL" 200 '[{"id":501,"name":"aikido-demo-gcp-dev"},{"id":702,"name":"aikido-demo-gcp-prod"}]'
  stub_response DELETE /api/public/v1/clouds/501 200 '{}'
  stub_response DELETE /api/public/v1/clouds/702 200 '{}'
  run step_aikido_clouds
  [ "$status" -eq 0 ]
  [ "$(calls_matching '^DELETE /api/public/v1/clouds/501')" -eq 1 ]
  [ "$(calls_matching '^DELETE /api/public/v1/clouds/702')" -eq 1 ]
}

@test "destroy tells you to delete a VM-scanning cloud in the UI on 400" {
  load_destroy
  state_set gcp_dev_cloud_id 501
  stub_response GET "$CLOUDS_URL" 200 '[{"id":501,"name":"aikido-demo-gcp-dev"}]'
  stub_response DELETE /api/public/v1/clouds/501 400 '{"error":"vm scanning enabled"}'
  run step_aikido_clouds
  [ "$status" -ne 0 ]
  [[ "$output" == *"delete cloud 501 in the Aikido UI"* ]]
}

@test "destroy warns about registries and does not fail" {
  load_destroy
  state_set gcp_dev_registry_id 601
  state_set gcp_prod_registry_id 602
  stub_response GET /api/public/v1/containers/registries/601 200 '{"id":601}'
  stub_response GET /api/public/v1/containers/registries/602 404 '{}'
  run step_gcp_registries
  [ "$status" -eq 0 ]
  [[ "$output" == *"Aikido registry 601 (GCP dev) can't be removed via API; remove it in the UI (Containers → registries)"* ]]
  [[ "$output" != *"602"* ]]
}

@test "destroy with no GCP state still runs terraform destroy" {
  load_destroy
  stub_response GET "$CLOUDS_URL" 200 '[]'
  run step_aikido_clouds
  [ "$status" -eq 0 ]
  [ "$(calls_matching '^DELETE')" -eq 0 ]
  run step_gcp_registries
  [ "$status" -eq 0 ]
  run step_terraform
  [ "$status" -eq 0 ]
  grep -q " destroy -auto-approve" "$STUB_DIR/terraform.calls"
}

@test "terraform destroy failing on Google auth points at ADC login" {
  load_destroy
  TF_RC=1
  export TF_RC
  printf '#!/usr/bin/env bash\necho "$*" >> "$STUB_DIR/terraform.calls"\ncase "$*" in *destroy*) echo "Error: could not find default credentials" >&2; exit 1;; esac\n' > "$STUB_DIR/bin/terraform"
  run step_terraform
  [ "$status" -ne 0 ]
  [[ "$output" == *"gcloud auth application-default login"* ]]
}

# shim for `aws` so the leftover report finds no tagged resources
_no_aws_leftovers() {
  printf '#!/usr/bin/env bash\nexit 0\n' > "$STUB_DIR/bin/aws"
  chmod +x "$STUB_DIR/bin/aws"
  stub_response GET "$CLOUDS_URL" 200 '[]'
}

@test "leftovers lists active aikido-demo GCP projects" {
  load_destroy
  _no_aws_leftovers
  GCLOUD_PROJECTS_OUT=$'aikido-demo-dev-abcd\naikido-demo-prod-efgh\n'
  export GCLOUD_PROJECTS_OUT
  run step_leftovers
  [ "$status" -ne 0 ]
  [[ "$output" == *"aikido-demo-dev-abcd"* ]]
  [[ "$output" == *"aikido-demo-prod-efgh"* ]]
  grep -qF "projects list --filter=name~^aikido-demo-(dev|prod)- AND lifecycleState=ACTIVE --format=value(projectId)" "$STUB_DIR/gcloud.calls"
}

@test "leftovers notes a gcloud failure without failing" {
  load_destroy
  _no_aws_leftovers
  GCLOUD_PROJECTS_FAIL=1
  export GCLOUD_PROJECTS_FAIL
  run step_leftovers
  [ "$status" -eq 0 ]
  [[ "$output" == *"(could not list GCP projects)"* ]]
}

# terraform shim that logs "argv | quota=<GOOGLE_CLOUD_QUOTA_PROJECT>" and serves `state show` for an env's project
# once $STUB_DIR/<env>-in-state exists; a targeted apply creates both (a fresh deploy creating the projects).
# TF_TARGET_DESTROY_RC sets the exit code of a targeted destroy.
_tf_quota_shim() {
  cat > "$STUB_DIR/bin/terraform" << 'STUB'
#!/usr/bin/env bash
echo "$* | quota=${GOOGLE_CLOUD_QUOTA_PROJECT:-}" >> "$STUB_DIR/terraform.calls"
case "$*" in
  *" state show "*)
    for env in dev prod; do
      if [[ "$*" == *"module.gcp[\"$env\"]"* && -f "$STUB_DIR/$env-in-state" ]]; then
        printf 'resource "google_project" "this" {\n    number     = "123"\n    project_id = "aikido-demo-%s-abcd"\n}\n' "$env"
        exit 0
      fi
    done
    exit 1 ;;
  *" apply "*-target*) touch "$STUB_DIR/dev-in-state" "$STUB_DIR/prod-in-state" ;;
  *" destroy "*-target*) exit "${TF_TARGET_DESTROY_RC:-0}" ;;
  *" output -raw "*) echo out ;;
  *" output -json gcp") printf '%s\n' "$TF_GCP_OUT" ;;
esac
exit 0
STUB
  chmod +x "$STUB_DIR/bin/terraform"
  : > "$STUB_DIR/terraform.calls"
}

@test "fresh deploy creates projects and APIs first, then applies with the dev quota project" {
  load_deploy
  _tf_quota_shim
  unset GOOGLE_CLOUD_QUOTA_PROJECT
  run step_terraform
  [ "$status" -eq 0 ]
  applies="$(grep ' apply ' "$STUB_DIR/terraform.calls" | grep -v -- -refresh-only)"
  [ "$(wc -l <<< "$applies")" -eq 2 ]
  first="$(sed -n 1p <<< "$applies")" second="$(sed -n 2p <<< "$applies")"
  [[ "$first" == *'-target=module.gcp["dev"].google_project_service.this'* ]]
  [[ "$first" == *'-target=module.gcp["prod"].google_project_service.this'* ]]
  [[ "$first" == *"| quota=" ]]
  [[ "$second" != *-target* ]]
  [[ "$second" == *"| quota=aikido-demo-dev-abcd" ]]
}

@test "fresh deploy runs a refresh-only apply before the targeted apply" {
  load_deploy
  _tf_quota_shim
  unset GOOGLE_CLOUD_QUOTA_PROJECT
  run step_terraform
  [ "$status" -eq 0 ]
  refresh="$(grep -n -- ' apply -refresh-only -auto-approve' "$STUB_DIR/terraform.calls" | head -1 | cut -d: -f1)"
  targeted="$(grep -n -- ' apply .*-target' "$STUB_DIR/terraform.calls" | head -1 | cut -d: -f1)"
  [ -n "$refresh" ] && [ -n "$targeted" ] && [ "$refresh" -lt "$targeted" ]
  grep -- '-refresh-only' "$STUB_DIR/terraform.calls" | grep -q "| quota=$"
}

@test "gcp_project_from_state returns nothing for an id outside the demo pattern" {
  load_deploy
  _tf_quota_shim
  touch "$STUB_DIR/dev-in-state"
  run gcp_project_from_state dev
  [ "$status" -eq 0 ]
  [ "$output" = "aikido-demo-dev-abcd" ]
  sed -i.bak 's/aikido-demo-%s-abcd/my-real-project/' "$STUB_DIR/bin/terraform"
  run gcp_project_from_state dev
  [ "$status" -ne 0 ]
  [ -z "$output" ]
}

@test "deploy with the dev project in state skips the targeted apply" {
  load_deploy
  _tf_quota_shim
  touch "$STUB_DIR/dev-in-state"
  unset GOOGLE_CLOUD_QUOTA_PROJECT
  run step_terraform
  [ "$status" -eq 0 ]
  [ "$(grep -c ' apply ' "$STUB_DIR/terraform.calls")" -eq 1 ]
  [ "$(grep -c -- -target "$STUB_DIR/terraform.calls")" -eq 0 ]
  grep ' apply ' "$STUB_DIR/terraform.calls" | grep -q "| quota=aikido-demo-dev-abcd$"
}

@test "deploy --skip-infra runs no apply" {
  load_deploy
  _tf_quota_shim
  SKIP_INFRA=1
  run step_terraform
  [ "$status" -eq 0 ]
  [ "$(grep -c ' apply ' "$STUB_DIR/terraform.calls")" -eq 0 ]
}

@test "destroy deletes the org policies with the dev quota project, then the rest without it" {
  load_destroy
  _tf_quota_shim
  touch "$STUB_DIR/dev-in-state"
  unset GOOGLE_CLOUD_QUOTA_PROJECT
  run step_terraform
  [ "$status" -eq 0 ]
  destroys="$(grep ' destroy ' "$STUB_DIR/terraform.calls")"
  [ "$(wc -l <<< "$destroys")" -eq 2 ]
  first="$(sed -n 1p <<< "$destroys")" second="$(sed -n 2p <<< "$destroys")"
  for env in dev prod; do
    for p in allowed_member_domains sa_key_creation uniform_bucket_access; do
      [[ "$first" == *"-target=module.gcp[\"$env\"].google_org_policy_policy.$p"* ]]
    done
  done
  [[ "$first" == *"| quota=aikido-demo-dev-abcd" ]]
  [[ "$second" != *-target* ]]
  [[ "$second" == *"| quota=" ]]
}

@test "destroy with only prod in state uses the prod project as quota project" {
  load_destroy
  _tf_quota_shim
  touch "$STUB_DIR/prod-in-state"
  unset GOOGLE_CLOUD_QUOTA_PROJECT
  run step_terraform
  [ "$status" -eq 0 ]
  first="$(grep ' destroy ' "$STUB_DIR/terraform.calls" | sed -n 1p)"
  [[ "$first" == *'-target=module.gcp["prod"].google_org_policy_policy.sa_key_creation'* ]]
  [[ "$first" == *"| quota=aikido-demo-prod-abcd" ]]
}

@test "destroy still runs the full destroy when the org policy destroy fails, and fails" {
  load_destroy
  _tf_quota_shim
  touch "$STUB_DIR/dev-in-state"
  TF_TARGET_DESTROY_RC=3
  export TF_TARGET_DESTROY_RC
  run step_terraform
  [ "$status" -eq 3 ]
  [[ "$output" == *"deleting the GCP org policies failed (rc 3); running the full destroy anyway"* ]]
  second="$(grep ' destroy ' "$STUB_DIR/terraform.calls" | sed -n 2p)"
  [ -n "$second" ]
  [[ "$second" != *-target* ]]
}

@test "destroy restores a quota project the user exported" {
  load_destroy
  _tf_quota_shim
  touch "$STUB_DIR/dev-in-state"
  export GOOGLE_CLOUD_QUOTA_PROJECT=users-own
  step_terraform > /dev/null 2>&1
  [ "$GOOGLE_CLOUD_QUOTA_PROJECT" = "users-own" ]
  first="$(grep ' destroy ' "$STUB_DIR/terraform.calls" | sed -n 1p)"
  second="$(grep ' destroy ' "$STUB_DIR/terraform.calls" | sed -n 2p)"
  [[ "$first" == *"| quota=aikido-demo-dev-abcd" ]]
  [[ "$second" == *"| quota=users-own" ]]
}

@test "the GCP deploy summary lists the file viewers without an attack command" {
  load_deploy
  run _gcp_summary
  [ "$status" -eq 0 ]
  [[ "$output" == *":8080"* ]]
  [[ "$output" != *"../private"* ]]
  [[ "$output" != *"exploit"* ]]
}
