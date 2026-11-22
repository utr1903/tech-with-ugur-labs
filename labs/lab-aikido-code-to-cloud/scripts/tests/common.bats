#!/usr/bin/env bats
load helpers

setup() {
  LAB_STATE_DIR="$(mktemp -d)"
  export LAB_STATE_DIR
  # shellcheck source=../lib/common.sh
  source "$LIB_DIR/common.sh"
}

@test "paths resolve from another cwd" {
  cd /tmp
  source "$LIB_DIR/common.sh"
  [ "$INFRA_DIR" = "$LAB_DIR/infra" ]
  [ "$SERVER_DIR" = "$LAB_DIR/apps/server" ]
  [ "$AIKIDO_CHART_DIR" = "$LAB_DIR/apps/aikido-k8s/helm" ]
  [ "$SERVER_CHART_DIR" = "$LAB_DIR/apps/server/helm" ]
  [ -f "$LAB_DIR/infra/00_main.tf" ]
}

@test "state_set then state_get roundtrips" {
  state_set aws_cloud_id 42
  state_set k8s_cloud_id 7
  [ "$(state_get aws_cloud_id)" = "42" ]
  [ "$(state_get k8s_cloud_id)" = "7" ]
}

@test "state_get on missing file prints empty" {
  run state_get aws_cloud_id
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "retry succeeds on third attempt" {
  n_file="$(mktemp)"; echo 0 > "$n_file"
  flaky() { local n; n=$(( $(cat "$n_file") + 1 )); echo "$n" > "$n_file"; [ "$n" -ge 3 ]; }
  run retry 5 0 flaky
  [ "$status" -eq 0 ]
  [ "$(cat "$n_file")" = "3" ]
}

@test "retry returns failure after N" {
  n_file="$(mktemp)"; echo 0 > "$n_file"
  never() { echo $(( $(cat "$n_file") + 1 )) > "$n_file"; return 3; }
  run retry 2 0 never
  [ "$status" -ne 0 ]
  [ "$(cat "$n_file")" = "2" ]
}

@test "require_env lists all missing vars" {
  unset FOO_MISSING_A FOO_MISSING_B
  run require_env FOO_MISSING_A FOO_MISSING_B
  [ "$status" -ne 0 ]
  [[ "$output" == *FOO_MISSING_A* ]]
  [[ "$output" == *FOO_MISSING_B* ]]
}

@test "load_env keeps pre-set vars" {
  ENV_FILE="$(mktemp)"
  printf 'AIKIDO_CLIENT_SECRET=file\nOTHER_FROM_FILE=yes\n' > "$ENV_FILE"
  export AIKIDO_CLIENT_SECRET=inline
  load_env
  [ "$AIKIDO_CLIENT_SECRET" = "inline" ]
  [ "$OTHER_FROM_FILE" = "yes" ]
}

@test "load_env dies when the file is missing" {
  ENV_FILE=/nonexistent/.env
  run load_env
  [ "$status" -ne 0 ]
  [[ "$output" == *".env"* ]]
}

@test "confirm dies without tty and without ASSUME_YES" {
  unset ASSUME_YES
  run confirm "go?" < /dev/null
  [ "$status" -ne 0 ]
}

@test "confirm passes with ASSUME_YES=1" {
  ASSUME_YES=1 run confirm "go?" < /dev/null
  [ "$status" -eq 0 ]
}

@test "state_set_once keeps the first value" {
  state_set_once deployed_at first
  state_set_once deployed_at second
  [ "$(state_get deployed_at)" = "first" ]
}

@test "minutes_since an ISO timestamp" {
  ts="$(date -u -r $(( $(date +%s) - 125 * 60 )) +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d "@$(( $(date +%s) - 125 * 60 ))" +%Y-%m-%dT%H:%M:%SZ)"
  [ "$(minutes_since "$ts")" = "125" ]
}

# Fake `aws` for aws_resource_exists: NotFound for ids containing "gone", success otherwise.
fake_aws() {
  mkdir -p "$BATS_TEST_TMPDIR/bin"
  cat > "$BATS_TEST_TMPDIR/bin/aws" <<'STUB'
#!/usr/bin/env bash
echo "$*" >> "$BATS_TEST_TMPDIR/aws_calls"
if [[ "$*" == *gone* ]]; then echo "An error occurred (InvalidGroup.NotFound)" >&2; exit 254; fi
echo '{}'
STUB
  chmod +x "$BATS_TEST_TMPDIR/bin/aws"
  PATH="$BATS_TEST_TMPDIR/bin:$PATH"
}

@test "aws_resource_exists: deleted EC2 resources from the tagging API are not leftovers" {
  fake_aws
  run aws_resource_exists arn:aws:ec2:eu-central-1:1:security-group/sg-gone1
  [ "$status" -ne 0 ]
  run aws_resource_exists arn:aws:ec2:eu-central-1:1:subnet/subnet-gone2
  [ "$status" -ne 0 ]
  grep -q "describe-security-groups --region eu-central-1 --group-ids sg-gone1" "$BATS_TEST_TMPDIR/aws_calls"
  grep -q "describe-subnets --region eu-central-1 --subnet-ids subnet-gone2" "$BATS_TEST_TMPDIR/aws_calls"
}

@test "aws_resource_exists: an existing EC2 resource is a leftover" {
  fake_aws
  run aws_resource_exists arn:aws:ec2:eu-central-1:1:vpc/vpc-123
  [ "$status" -eq 0 ]
}

@test "aws_resource_exists: unknown resource types count as existing" {
  fake_aws
  run aws_resource_exists arn:aws:s3:::aikido-demo-data-gone
  [ "$status" -eq 0 ]
}

@test "load_env keeps pre-set vars when .env has no trailing newline" {
  ENV_FILE="$(mktemp)"
  printf 'OTHER_FROM_FILE=yes\nAIKIDO_CLIENT_SECRET=file' > "$ENV_FILE"
  export AIKIDO_CLIENT_SECRET=inline
  load_env
  [ "$AIKIDO_CLIENT_SECRET" = "inline" ]
  [ "$OTHER_FROM_FILE" = "yes" ]
}

@test "a stray STATE_DIR in the environment does not redirect lab state" {
  unset LAB_STATE_DIR
  export STATE_DIR=/tmp/somewhere-else
  source "$LIB_DIR/common.sh"
  [ "$STATE_DIR" = "$LAB_DIR/.state" ]
}

@test "LAB_STATE_DIR overrides the state dir" {
  export LAB_STATE_DIR=/tmp/lab-state-override
  source "$LIB_DIR/common.sh"
  [ "$STATE_DIR" = /tmp/lab-state-override ]
}

# Fake `helm status -o json` returning the given release status (or failing when empty).
fake_helm() {
  mkdir -p "$BATS_TEST_TMPDIR/bin"
  if [ -z "$1" ]; then
    printf '#!/usr/bin/env bash\necho "Error: release: not found" >&2\nexit 1\n' > "$BATS_TEST_TMPDIR/bin/helm"
  else
    printf '#!/usr/bin/env bash\necho "{\\"info\\":{\\"status\\":\\"%s\\"}}"\n' "$1" > "$BATS_TEST_TMPDIR/bin/helm"
  fi
  chmod +x "$BATS_TEST_TMPDIR/bin/helm"
  PATH="$BATS_TEST_TMPDIR/bin:$PATH"
}

@test "helm_release_deployed: deployed release" {
  fake_helm deployed
  run helm_release_deployed aikido aikido
  [ "$status" -eq 0 ]
}

@test "helm_release_deployed: failed release does not count" {
  fake_helm failed
  run helm_release_deployed aikido aikido
  [ "$status" -ne 0 ]
}

@test "helm_release_deployed: missing release" {
  fake_helm ""
  run helm_release_deployed aikido aikido
  [ "$status" -ne 0 ]
}
