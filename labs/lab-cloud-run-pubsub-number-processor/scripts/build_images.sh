#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/common.sh"
load_config
require_tools docker gcloud
outputs=$(foundation_outputs)
host="$REGION-docker.pkg.dev"
# The access token is piped to Docker and kept in a temporary config directory.
build_tmp=$(mktemp -d)
trap 'rm -rf "$build_tmp"' EXIT
export DOCKER_CONFIG="$build_tmp"
gcloud auth print-access-token | docker login -u oauth2accesstoken --password-stdin "https://$host"
tag="build-$(date +%s)-$$"
server_image=
processor_image=
for app in server processor; do
  repo=$(jq -er ".${app}_repository" <<< "$outputs")
  [[ "$repo" == "$host/$PROJECT_ID/$LAB_NAME-$app" ]] || die 'Repository output does not match saved configuration'
  docker buildx build --platform linux/amd64 --push -f "$LAB_ROOT/Dockerfile.$app" -t "$repo/app:$tag" "$LAB_ROOT"
  digest=$(gcloud artifacts docker images describe "$repo/app:$tag" --project="$PROJECT_ID" --format='value(image_summary.digest)')
  [[ "$digest" =~ ^sha256:[a-f0-9]{64}$ ]] || die 'Registry did not return a sha256 digest'
  printf -v "${app}_image" '%s' "$repo/app@$digest"
done
jq -n --arg server "$server_image" --arg processor "$processor_image" '{server:$server,processor:$processor}' > "$IMAGES.tmp"
mv "$IMAGES.tmp" "$IMAGES"
