#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=scripts/lib.sh
source scripts/lib.sh

kind delete cluster --name "${CLUSTER}" 2>/dev/null || true
docker compose down -v
docker rmi demo-app:v1 demo-app:v2 demo-app:v4 2>/dev/null || true
rm -rf tmp
echo "Lab torn down."
