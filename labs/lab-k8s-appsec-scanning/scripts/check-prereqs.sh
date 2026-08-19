#!/usr/bin/env bash
set -euo pipefail
tools=(docker kind kubectl trivy semgrep gitleaks jq node npm)
missing=0
for tool in "${tools[@]}"; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "MISSING: $tool"; missing=1
  fi
done
if [[ "$missing" -ne 0 ]]; then
  echo "Install the missing tools above (macOS: brew install trivy semgrep gitleaks kind kubectl jq) and re-run." >&2
  exit 1
fi
echo "All prerequisites present."
