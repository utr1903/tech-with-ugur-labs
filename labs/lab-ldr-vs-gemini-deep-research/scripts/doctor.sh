#!/usr/bin/env bash
# Checks the laptop before anything is deployed: tools, Docker, AWS login
# and the GPU quota. Prints one line per check and fails if any check fails.
set -euo pipefail

region="${REGION:-eu-central-1}"
failed=0

ok() { printf '  ok    %s\n' "$1"; }
bad() { printf '  FAIL  %s\n' "$1"; failed=1; }

for tool in terraform aws ssh ssh-keygen rsync curl docker openssl; do
  if command -v "$tool" >/dev/null 2>&1; then ok "$tool found"; else bad "$tool is not installed"; fi
done

if command -v docker >/dev/null 2>&1; then
  if docker info >/dev/null 2>&1; then ok "Docker daemon is running"; else bad "Docker is installed but the daemon does not answer"; fi
  if docker compose version >/dev/null 2>&1; then ok "docker compose found"; else bad "the docker compose plugin is missing"; fi
fi

if command -v terraform >/dev/null 2>&1; then
  tf_version="$(terraform version -json | sed -n 's/.*"terraform_version": *"\([^"]*\)".*/\1/p')"
  if [ "$tf_version" = "1.16.3" ]; then ok "Terraform 1.16.3"; else bad "Terraform $tf_version found, the lab pins 1.16.3"; fi
fi

if command -v aws >/dev/null 2>&1; then
  if aws --version 2>&1 | grep -q '^aws-cli/2\.'; then ok "AWS CLI v2"; else bad "AWS CLI v2 is required"; fi

  if aws sts get-caller-identity --region "$region" >/dev/null 2>&1; then
    ok "AWS login is valid"
  else
    bad "No valid AWS login. Run: aws login"
  fi

  quota="$(aws service-quotas get-service-quota --region "$region" \
    --service-code ec2 --quota-code L-DB2E81BA \
    --query 'Quota.Value' --output text 2>/dev/null || echo 0)"
  quota="${quota%.*}"
  case "$quota" in '' | *[!0-9]*) quota=0 ;; esac
  if [ "$quota" -ge 8 ]; then
    ok "G and VT on-demand quota in $region: $quota vCPUs"
  else
    bad "G and VT on-demand quota in $region is $quota vCPUs; the VM needs 8"
  fi
fi

exit "$failed"
