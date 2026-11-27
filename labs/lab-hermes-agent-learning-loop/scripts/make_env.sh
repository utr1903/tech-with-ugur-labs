#!/usr/bin/env bash
# Creates .env from .env.example: the GCP project from gcloud, a fresh API
# server key and your user and group ids. An existing .env is never
# touched. The key is never printed.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
env_file="${root}/.env"
example="${root}/.env.example"

if [[ -e "${env_file}" ]]; then
  echo ".env already exists; leaving it as it is."
  exit 0
fi

project="$(gcloud config get-value project 2>/dev/null || true)"
key="$(openssl rand -hex 24)"
uid="$(id -u)"
gid="$(id -g)"

umask 077
while IFS= read -r line; do
  case "${line}" in
    VERTEX_PROJECT_ID=your-gcp-project)
      if [[ -n "${project}" ]]; then echo "VERTEX_PROJECT_ID=${project}"; else echo "${line}"; fi
      ;;
    API_SERVER_KEY=*) echo "API_SERVER_KEY=${key}" ;;
    HERMES_UID=*) echo "HERMES_UID=${uid}" ;;
    HERMES_GID=*) echo "HERMES_GID=${gid}" ;;
    *) echo "${line}" ;;
  esac
done <"${example}" >"${env_file}"

echo "Created .env with a generated API server key."
if [[ -z "${project}" ]]; then
  echo "No gcloud default project found: set VERTEX_PROJECT_ID in .env."
fi
