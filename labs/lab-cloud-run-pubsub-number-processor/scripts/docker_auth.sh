#!/usr/bin/env bash
# Preserve only the selected daemon connection and executable plugin, never
# copy the reader's registry auths, credential helpers, or other contexts.
prepare_docker_config() {
  local buildx_plugin
  docker_context=$(docker context show)
  buildx_plugin=$(docker info --format '{{range .ClientInfo.Plugins}}{{if eq .Name "buildx"}}{{.Path}}{{end}}{{end}}')
  [[ -n "$docker_context" && -x "$buildx_plugin" ]] || die 'Docker must have a working selected context and buildx plugin'
  build_tmp=$(mktemp -d)
  trap 'rm -rf "$build_tmp"' EXIT
  mkdir -p "$build_tmp/cli-plugins"
  ln -s "$buildx_plugin" "$build_tmp/cli-plugins/docker-buildx"
  if [[ "$docker_context" != default ]]; then
    docker context export "$docker_context" "$build_tmp/selected.dockercontext"
    DOCKER_CONFIG="$build_tmp" docker context import "$docker_context" "$build_tmp/selected.dockercontext"
    rm -f "$build_tmp/selected.dockercontext"
    export DOCKER_CONTEXT="$docker_context"
  fi
  # With the default context, retain any caller-selected DOCKER_HOST/TLS env.
  export DOCKER_CONFIG="$build_tmp"
}
