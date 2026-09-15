#!/usr/bin/env bash
# Credential-free checks. Only package/provider downloads and local Docker run.
set -euo pipefail
source "$(dirname "$0")/common.sh"
require_tools docker uv terraform jq shellcheck
cd "$LAB_ROOT"
for script in scripts/*.sh scripts/tests/*.sh; do bash -n "$script"; done
shellcheck -x -P SCRIPTDIR -P "$LAB_ROOT" scripts/*.sh scripts/tests/*.sh
bash scripts/tests/lifecycle_test.sh
bash scripts/tests/e2e_test.sh
bash scripts/tests/e2e_iam_test.sh
docker run --rm --platform linux/amd64 -v "$LAB_ROOT/server:/source:ro" node:22.20.0-bookworm-slim \
  sh -ec 'mkdir /tmp/server; cp /source/package.json /source/package-lock.json /source/tsconfig.json /source/biome.json /source/knip.json /tmp/server/; cp -R /source/src /tmp/server/src; cd /tmp/server; npm ci; npm test; npm run typecheck; npm run lint; npm run knip'
(
  cd processor
  uv sync --locked --python 3.12
  uv run pytest
  uv run ruff check
  uv run ruff format --check
  uv run mypy
  uv run deptry .
)
terraform fmt -check -recursive terraform
for stage in foundation services; do
  terraform -chdir="terraform/$stage" init -backend=false -input=false -lockfile=readonly
  terraform -chdir="terraform/$stage" validate
  terraform -chdir="terraform/$stage" test
done
echo 'PASS: local checks. No GCP deployment, IAM enforcement, delivery, or teardown was exercised.'
