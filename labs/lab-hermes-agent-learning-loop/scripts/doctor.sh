#!/usr/bin/env bash
# Checks the laptop before Hermes starts: Docker, gcloud, Application
# Default Credentials, the Vertex AI API and one direct call to the model.
# Prints one line per check and fails if any check fails. The access token
# is never printed.
set -euo pipefail

adc_file="${ADC_FILE:-${HOME}/.config/gcloud/application_default_credentials.json}"
model="${HERMES_MODEL:-google/gemma-4-26b-a4b-it-maas}"
failed=0

ok() { printf '  ok    %s\n' "$1"; }
bad() { printf '  FAIL  %s\n' "$1"; failed=1; }

for tool in docker gcloud curl openssl; do
  if command -v "$tool" >/dev/null 2>&1; then ok "$tool found"; else bad "$tool is not installed"; fi
done

if command -v docker >/dev/null 2>&1; then
  if docker info >/dev/null 2>&1; then ok "Docker daemon is running"; else bad "Docker is installed but the daemon does not answer"; fi
  if docker compose version >/dev/null 2>&1; then ok "docker compose found"; else bad "the docker compose plugin is missing"; fi
fi

if [[ -f "${adc_file}" ]]; then
  ok "Application Default Credentials at ${adc_file}"
else
  bad "No ADC file at ${adc_file}. Run: gcloud auth application-default login"
fi

if ! command -v gcloud >/dev/null 2>&1; then
  exit 1
fi

project="${VERTEX_PROJECT_ID:-$(gcloud config get-value project 2>/dev/null || true)}"
if [[ -z "${project}" ]]; then
  bad "No GCP project. Run: gcloud config set project <your-project>"
  exit 1
fi
ok "GCP project ${project}"

enabled="$(gcloud services list --enabled --project "${project}" \
  --filter=config.name=aiplatform.googleapis.com --format='value(config.name)' 2>/dev/null || true)"
if [[ -n "${enabled}" ]]; then
  ok "Vertex AI API is enabled"
else
  bad "Vertex AI API is not enabled in ${project}. Run: make vertex"
  exit 1
fi

if ! token="$(gcloud auth application-default print-access-token 2>/dev/null)"; then
  bad "ADC cannot mint a token. Run: gcloud auth application-default login"
  exit 1
fi

url="https://aiplatform.googleapis.com/v1/projects/${project}/locations/global/endpoints/openapi/chat/completions"
body="{\"model\": \"${model}\", \"max_tokens\": 8, \"messages\": [{\"role\": \"user\", \"content\": \"Reply with the single word ready.\"}]}"
# The token goes in through a header file on stdin so it never shows in ps.
status="$(printf 'Authorization: Bearer %s\n' "${token}" |
  curl -s -o /dev/null -w '%{http_code}' --max-time 60 \
    -H @- -H 'Content-Type: application/json' -d "${body}" "${url}" || true)"
unset token
if [[ "${status}" = "200" ]]; then
  ok "${model} answers on Vertex AI"
else
  bad "${model} probe returned HTTP ${status:-none}"
fi

exit "$failed"
