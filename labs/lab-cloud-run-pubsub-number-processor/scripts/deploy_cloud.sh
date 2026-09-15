#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/common.sh"
usage() { echo "usage: $0 [--dry-run] [--destroy]" >&2; exit 1; }
dry_run=false
destroy=false
for arg in "$@"; do
  case "$arg" in --dry-run) dry_run=true ;; --destroy) destroy=true ;; *) usage ;; esac
done
load_config
if $destroy; then
  [[ -f "$CONFIG" ]] || die 'No saved deployment configuration; nothing to destroy'
  # Images are irrelevant on destroy; valid placeholders also permit recovery
  # when bootstrap failed before its first image push.
  SERVER_IMAGE="$REGION-docker.pkg.dev/$PROJECT_ID/$LAB_NAME-server/app@sha256:$(printf '%064d' 0)"
  PROCESSOR_IMAGE="$REGION-docker.pkg.dev/$PROJECT_ID/$LAB_NAME-processor/app@sha256:$(printf '%064d' 0)"
  roots=(services foundation)
  action=(destroy -auto-approve)
  if $dry_run; then action=(plan -destroy); fi
else
  if ! $dry_run; then
    source "$LAB_ROOT/scripts/preflight.sh"
    preflight
    save_config
  fi
  roots=(foundation services)
  action=(apply -auto-approve)
  if $dry_run; then action=(plan); fi
fi
for stage in "${roots[@]}"; do
  args=("${TF_ARGS[@]}")
  if [[ "$stage" == foundation ]]; then
    args+=("-var=legacy_token_creator=$LEGACY_TOKEN_CREATOR")
  else
    if ! $destroy && ! $dry_run; then
      "$LAB_ROOT/scripts/build_images.sh"
    fi
    if ! $destroy; then load_images; fi
    args+=("-var=server_image=$SERVER_IMAGE" "-var=processor_image=$PROCESSOR_IMAGE")
  fi
  terraform -chdir="$LAB_ROOT/terraform/$stage" init -input=false -lockfile=readonly
  terraform -chdir="$LAB_ROOT/terraform/$stage" "${action[@]}" -input=false "${args[@]}"
done
if $destroy && ! $dry_run; then
  rm -f "$CONFIG" "$IMAGES"
  echo 'Lab resources removed. Project, enabled APIs, and local Terraform state retained.'
fi
