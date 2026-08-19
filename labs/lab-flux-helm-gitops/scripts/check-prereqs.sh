#!/usr/bin/env bash
set -euo pipefail

# Every host tool the lab scripts call, with the versions the lab was tested against.
tools=(docker kind kubectl helm flux sops age-keygen yq jq git curl openssl)

missing=0
for tool in "${tools[@]}"; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "MISSING: $tool"
    missing=1
  fi
done

if [[ "$missing" -ne 0 ]]; then
  echo "Install the missing tools above (macOS: brew install kind kubectl helm fluxcd/tap/flux sops age yq jq) and re-run."
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "Docker daemon is not running."
  exit 1
fi

echo "All prerequisites found."
