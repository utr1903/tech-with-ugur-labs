#!/usr/bin/env bash
# Creates .env from .env.example with fresh random secrets.
# An existing .env is never touched. Secrets are never printed.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
env_file="${root}/.env"
example="${root}/.env.example"

if [[ -e "${env_file}" ]]; then
  echo ".env already exists; leaving it as it is."
  exit 0
fi

password="$(openssl rand -hex 24)"
secret="$(openssl rand -hex 24)"

umask 077
while IFS= read -r line; do
  case "${line}" in
    LDR_LAB_PASSWORD=*) echo "LDR_LAB_PASSWORD=${password}" ;;
    SEARXNG_SECRET=*) echo "SEARXNG_SECRET=${secret}" ;;
    *) echo "${line}" ;;
  esac
done <"${example}" >"${env_file}"

echo "Created .env with generated secrets."
echo "Set SEC_USER_AGENT (and GEMINI_API_KEY for the frontier runs) in it."
