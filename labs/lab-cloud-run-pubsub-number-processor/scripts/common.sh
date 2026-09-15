#!/usr/bin/env bash
# Shared configuration is JSON data, never executable shell input.
set -euo pipefail
if (( BASH_VERSINFO[0] < 5 )); then
  echo "ERROR: Bash 5 or newer is required; put it on PATH before running Make." >&2
  exit 1
fi
LAB_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG="$LAB_ROOT/.lab/config.json"
IMAGES="$LAB_ROOT/.lab/images.json"
die() { echo "ERROR: $*" >&2; exit 1; }
require_tools() { for tool in "$@"; do command -v "$tool" >/dev/null || die "Install $tool first"; done; }
load_config() {
  require_tools jq terraform
  if [[ -f "$CONFIG" ]]; then
    jq -e 'type == "object" and (.project_id|type=="string") and (.region|type=="string") and (.lab_name|type=="string") and (.legacy_token_creator|type=="boolean")' "$CONFIG" >/dev/null || die 'Invalid saved config'
    for key in PROJECT_ID REGION LAB_NAME LEGACY_TOKEN_CREATOR; do
      saved=$(jq -r ".$(echo "$key" | tr '[:upper:]' '[:lower:]')" "$CONFIG")
      [[ -z "${!key:-}" || "${!key}" == "$saved" ]] || die "$key differs from saved configuration; finish teardown first"
      printf -v "$key" '%s' "$saved"
    done
  else
    PROJECT_ID=${PROJECT_ID:-}
    REGION=${REGION:-europe-west1}
    LAB_NAME=${LAB_NAME:-number-pipeline}
    LEGACY_TOKEN_CREATOR=${LEGACY_TOKEN_CREATOR:-false}
  fi
  [[ "$PROJECT_ID" =~ ^[a-z][a-z0-9-]{4,28}[a-z0-9]$ ]] || die 'Set a valid PROJECT_ID'
  [[ "$REGION" =~ ^[a-z]+-[a-z]+[0-9]+$ ]] || die 'Invalid REGION'
  [[ "$LAB_NAME" =~ ^[a-z][a-z0-9-]{2,17}[a-z0-9]$ ]] || die 'LAB_NAME must be 4–19 lowercase letters, digits or hyphens'
  [[ "$LEGACY_TOKEN_CREATOR" == true || "$LEGACY_TOKEN_CREATOR" == false ]] || die 'LEGACY_TOKEN_CREATOR must be true or false'
  export PROJECT_ID REGION LAB_NAME LEGACY_TOKEN_CREATOR
  # Used by lifecycle consumers of this shared module.
  # shellcheck disable=SC2034
  TF_ARGS=("-var=project_id=$PROJECT_ID" "-var=region=$REGION" "-var=lab_name=$LAB_NAME")
}
save_config() {
  mkdir -p "$LAB_ROOT/.lab"
  jq -n --arg project_id "$PROJECT_ID" --arg region "$REGION" --arg lab_name "$LAB_NAME" --argjson legacy_token_creator "$LEGACY_TOKEN_CREATOR" \
    '{project_id:$project_id,region:$region,lab_name:$lab_name,legacy_token_creator:$legacy_token_creator}' > "$CONFIG.tmp"
  mv "$CONFIG.tmp" "$CONFIG"
}
load_images() {
  [[ -f "$IMAGES" ]] || die 'Bootstrap images are missing; run make bootstrap before planning services'
  SERVER_IMAGE=$(jq -er '.server' "$IMAGES")
  PROCESSOR_IMAGE=$(jq -er '.processor' "$IMAGES")
  for image in "$SERVER_IMAGE" "$PROCESSOR_IMAGE"; do
    [[ "$image" =~ ^${REGION}-docker.pkg.dev/${PROJECT_ID}/${LAB_NAME}-(server|processor)/app@sha256:[a-f0-9]{64}$ ]] || die 'Invalid saved digest images'
  done
}
foundation_outputs() { terraform -chdir="$LAB_ROOT/terraform/foundation" output -json deployment; }
