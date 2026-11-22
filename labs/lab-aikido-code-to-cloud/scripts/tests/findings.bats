#!/usr/bin/env bats
# Tests for scripts/findings.sh and aikido_export_issues.
load helpers

FINDINGS="$(cd "$BATS_TEST_DIRNAME/.." && pwd)/findings.sh"
DEPLOYED=1000000

# 4 issues: sast x2 (one group, critical + high), cloud x1 (low), leaked_secret x1 (high).
fixture() {
  jq -cn --argjson d "$DEPLOYED" '[
    {id: 1, group_id: 10, type: "sast", severity: "critical", first_detected_at: ($d + 600)},
    {id: 2, group_id: 10, type: "sast", severity: "high", first_detected_at: ($d + 1200)},
    {id: 3, group_id: 20, type: "cloud", severity: "low", first_detected_at: ($d + 1800)},
    {id: 4, group_id: 30, type: "leaked_secret", severity: "high", first_detected_at: ($d - 120)}
  ]'
}

setup() {
  setup_stubs
  LAB_STATE_DIR="$(mktemp -d)"
  LAB_ENV_FILE="$LAB_STATE_DIR/env"
  printf 'AIKIDO_CLIENT_ID=cid\nAIKIDO_CLIENT_SECRET=csecret-XYZ\n' > "$LAB_ENV_FILE"
  export LAB_STATE_DIR LAB_ENV_FILE AIKIDO_RETRY_DELAY=0
  stub_token
  # shellcheck source=../findings.sh
  source "$FINDINGS"
}

@test "aikido_export_issues fetches open issues" {
  stub_response GET '/api/public/v1/issues/export?filter_status=open' 200 "$(fixture)"
  run aikido_export_issues
  [ "$status" -eq 0 ]
  [ "$(jq 'length' <<< "$output")" -eq 4 ]
}

@test "summary counts issues, groups and severities per type" {
  run summarize_findings "$DEPLOYED" <<< "$(fixture)"
  [ "$status" -eq 0 ]
  [ "${lines[0]}" = "$(printf 'type\tissues\tgroups\tcritical\thigh\tmedium\tlow\tfirst_seen_min')" ]
  [[ "${lines[1]}" == "$(printf 'cloud\t1\t1\t0\t0\t0\t1\t')"* ]]
  [[ "${lines[2]}" == "$(printf 'leaked_secret\t1\t1\t0\t1\t0\t0\t')"* ]]
  [[ "${lines[3]}" == "$(printf 'sast\t2\t1\t1\t1\t0\t0\t')"* ]]
}

@test "first_seen_min is minutes since deploy" {
  run summarize_findings "$DEPLOYED" <<< "$(fixture)"
  [[ "${lines[3]}" == *$'\t'10 ]]
  [[ "${lines[1]}" == *$'\t'30 ]]
  [[ "${lines[2]}" == *$'\t'-2 ]]
}

@test "first_seen_min is - without a deploy time" {
  run summarize_findings "" <<< "$(fixture)"
  [ "$status" -eq 0 ]
  for i in 1 2 3; do [[ "${lines[$i]}" == *$'\t-' ]]; done
}

@test "empty export prints only the header" {
  run summarize_findings "$DEPLOYED" <<< '[]'
  [ "$status" -eq 0 ]
  [ "${#lines[@]}" -eq 1 ]
}

@test "findings.sh writes the snapshot into the state dir" {
  echo '{"deployed_at":"1970-01-12T13:46:40Z"}' > "$LAB_STATE_DIR/aikido.json"   # = 1000000
  stub_response GET '/api/public/v1/issues/export?filter_status=open' 200 "$(fixture)"
  run bash "$FINDINGS"
  [ "$status" -eq 0 ]
  snap="$(ls "$LAB_STATE_DIR"/findings-*.json)"
  [ "$(jq -c . "$snap")" = "$(fixture)" ]
  [[ "$output" == *"$snap"* ]]
  [[ "$output" == *$'sast\t2\t1\t1\t1\t0\t0\t10'* ]]
}

@test "findings.sh works without aikido.json" {
  stub_response GET '/api/public/v1/issues/export?filter_status=open' 200 "$(fixture)"
  run bash "$FINDINGS"
  [ "$status" -eq 0 ]
  [[ "$output" == *$'sast\t2\t1\t1\t1\t0\t0\t-'* ]]
}

@test "findings.sh never prints the client secret or token" {
  stub_response GET '/api/public/v1/issues/export?filter_status=open' 500 '{"reason_phrase":"boom"}'
  run bash "$FINDINGS"
  [ "$status" -ne 0 ]
  [[ "$output" != *csecret-XYZ* ]]
  [[ "$output" != *tok-SECRET-123* ]]
}
