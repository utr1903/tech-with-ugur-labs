#!/usr/bin/env bats
# Reader inputs are checked before anything slow or billable starts.
load helpers

setup() {
  T="$(mktemp -d)"
  LAB_STATE_DIR="$T/state" LAB_ENV_FILE="$T/env"
  printf 'AIKIDO_CLIENT_ID=cid\nAIKIDO_CLIENT_SECRET=csecret-XYZ\n' > "$LAB_ENV_FILE"
  export LAB_STATE_DIR LAB_ENV_FILE
  unset AIKIDO_REPO_NAME
}

stub_cloud_checks() {
  INFRA_DIR="$T/infra"
  mkdir -p "$INFRA_DIR"
  require_tools() { :; }
  aws_preflight() { echo called > "$T/aws_preflight"; }
  gcp_preflight() { :; }
  confirm() { :; }
}

load_deploy() {
  # shellcheck source=../deploy.sh
  source "$BATS_TEST_DIRNAME/../deploy.sh"
  stub_cloud_checks
}

@test "require_tfvars fails without infra/terraform.tfvars" {
  source "$LIB_DIR/common.sh"
  INFRA_DIR="$T/infra"
  mkdir -p "$INFRA_DIR"
  run require_tfvars
  [ "$status" -eq 1 ]
  [[ "$output" == *"terraform.tfvars.example"* ]]
}

@test "require_tfvars passes when the file exists" {
  source "$LIB_DIR/common.sh"
  INFRA_DIR="$T/infra"
  mkdir -p "$INFRA_DIR"
  touch "$INFRA_DIR/terraform.tfvars"
  run require_tfvars
  [ "$status" -eq 0 ]
}

@test "deploy preflight stops when AIKIDO_REPO_NAME is missing" {
  load_deploy
  touch "$INFRA_DIR/terraform.tfvars"
  run step_preflight
  [ "$status" -eq 1 ]
  [[ "$output" == *"AIKIDO_REPO_NAME"* ]]
  [ ! -e "$T/aws_preflight" ]
}

@test "deploy preflight stops without infra/terraform.tfvars" {
  echo 'AIKIDO_REPO_NAME=my-aikido-lab' >> "$LAB_ENV_FILE"
  load_deploy
  run step_preflight
  [ "$status" -eq 1 ]
  [[ "$output" == *"terraform.tfvars.example"* ]]
  [ ! -e "$T/aws_preflight" ]
}

@test "deploy preflight passes with tfvars and a repo name" {
  echo 'AIKIDO_REPO_NAME=my-aikido-lab' >> "$LAB_ENV_FILE"
  load_deploy
  touch "$INFRA_DIR/terraform.tfvars"
  run step_preflight
  [ "$status" -eq 0 ]
  [ -e "$T/aws_preflight" ]
}

@test "deploy scans the repo named in AIKIDO_REPO_NAME" {
  load_deploy
  export AIKIDO_REPO_NAME=my-aikido-lab
  aikido_find_code_repo() { echo "$1" > "$T/repo_asked"; echo 42; }
  aikido_scan_repo() { :; }
  run step_repo_scan
  [ "$status" -eq 0 ]
  [ "$(cat "$T/repo_asked")" = "my-aikido-lab" ]
}

@test "destroy preflight stops without infra/terraform.tfvars" {
  # shellcheck source=../destroy.sh
  source "$BATS_TEST_DIRNAME/../destroy.sh"
  stub_cloud_checks
  run step_preflight
  [ "$status" -eq 1 ]
  [[ "$output" == *"terraform.tfvars.example"* ]]
}
