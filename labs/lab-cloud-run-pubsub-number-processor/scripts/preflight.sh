#!/usr/bin/env bash
# Read-only checks before the first resource mutation. Tokens stay in memory.
preflight() {
  require_tools gcloud curl docker
  docker info >/dev/null
  local project billing token permissions account
  project=$(gcloud projects describe "$PROJECT_ID" --format=json)
  jq -e '.lifecycleState == "ACTIVE"' <<< "$project" >/dev/null || die 'Project must be ACTIVE'
  billing=$(gcloud billing projects describe "$PROJECT_ID" --format=json)
  jq -e '.billingEnabled == true' <<< "$billing" >/dev/null || die 'Enable project billing first'
  account=$(gcloud auth list --filter=status:ACTIVE --format='value(account)')
  [[ -n "$account" ]] || die 'Sign in with gcloud first'
  gcloud auth application-default print-access-token >/dev/null || die 'Configure Application Default Credentials first'
  token=$(gcloud auth print-access-token)
  permissions=$(curl --silent --show-error --fail --max-time 30 \
    -H "Authorization: Bearer $token" -H 'Content-Type: application/json' \
    -d '{"permissions":["serviceusage.services.enable"]}' \
    "https://cloudresourcemanager.googleapis.com/v1/projects/$PROJECT_ID:testIamPermissions")
  jq -e '.permissions | index("serviceusage.services.enable") != null' <<< "$permissions" >/dev/null || die 'Deployer needs serviceusage.services.enable'
  echo "Using gcloud account $account for project $PROJECT_ID. Terraform uses your separately configured ADC." >&2
}
