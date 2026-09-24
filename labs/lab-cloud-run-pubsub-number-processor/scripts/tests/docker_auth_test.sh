#!/usr/bin/env bash
# Empty auth config must not hide the selected Docker context or user buildx.
set -euo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/bin" "$tmp/original/cli-plugins"
export ORIGINAL_DOCKER_CONFIG="$tmp/original" DOCKER_CONFIG="$tmp/original"
printf '%s' '{"currentContext":"desktop-linux","auths":{"unrelated.example":{"auth":"do-not-copy"}}}' > "$DOCKER_CONFIG/config.json"
printf '%s\n' '#!/bin/sh' 'exit 0' > "$DOCKER_CONFIG/cli-plugins/docker-buildx"
chmod +x "$DOCKER_CONFIG/cli-plugins/docker-buildx"
cat > "$tmp/bin/docker" <<'FAKE'
#!/usr/bin/env bash
set -eu
case "$*" in
  'context show') echo desktop-linux;;
  info*) printf '%s\n' "$ORIGINAL_DOCKER_CONFIG/cli-plugins/docker-buildx";;
  'context export desktop-linux '*) printf '%s' 'selected-context-only' > "$4";;
  'context import desktop-linux '*)
    [[ $(cat "$4") == selected-context-only ]]
    mkdir -p "$DOCKER_CONFIG/contexts"
    touch "$DOCKER_CONFIG/contexts/desktop-linux";;
  'login '*)
    [[ "$DOCKER_CONFIG" != "$ORIGINAL_DOCKER_CONFIG" ]]
    read -r token
    [[ "$token" == temporary-token ]]
    printf '%s' '{"auths":{"europe-west1-docker.pkg.dev":{"auth":"temporary-token"}}}' > "$DOCKER_CONFIG/config.json";;
  'buildx '*)
    [[ -x "$DOCKER_CONFIG/cli-plugins/docker-buildx" ]] || { echo 'FAIL: buildx plugin unavailable'; exit 1; }
    [[ "${DOCKER_CONTEXT:-}" == desktop-linux && -f "$DOCKER_CONFIG/contexts/desktop-linux" ]] || { echo 'FAIL: selected context unavailable'; exit 1; }
    [[ $(jq -r '.auths["unrelated.example"] // empty' "$DOCKER_CONFIG/config.json") == '' ]] || { echo 'FAIL: unrelated registry auth copied'; exit 1; };;
  *) exit 1;;
esac
FAKE
chmod +x "$tmp/bin/docker"
export PATH="$tmp/bin:$PATH"
source "$root/scripts/common.sh"
[[ -f "$root/scripts/docker_auth.sh" ]] || { echo 'FAIL: isolated Docker config setup missing'; exit 1; }
source "$root/scripts/docker_auth.sh"
(
  prepare_docker_config
  printf '%s\n' "$DOCKER_CONFIG" > "$tmp/created"
  printf '%s\n' temporary-token | docker login -u oauth2accesstoken --password-stdin https://europe-west1-docker.pkg.dev
  docker buildx build --builder "$docker_context" --platform linux/amd64 --push .
)
[[ ! -e $(cat "$tmp/created") ]] || { echo 'FAIL: temporary auth was retained'; exit 1; }
[[ $(jq -r '.auths["unrelated.example"].auth' "$ORIGINAL_DOCKER_CONFIG/config.json") == do-not-copy ]]
echo 'PASS: selected Docker context/buildx, isolated registry auth, unchanged user credentials, cleanup'
