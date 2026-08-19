#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

scan_all() {
  rm -rf tmp && mkdir -p tmp
  for v in vulnerable hardened; do
    ./scripts/scan-code.sh "$v"; ./scripts/scan-build.sh "$v"; ./scripts/scan-deploy.sh "$v"
  done
}

case "${1:-all}" in
  scan)      scan_all ;;
  admission) ./scripts/admission.sh all ;;
  report)    ./scripts/consolidate.sh ;;
  e2e)       ./scripts/e2e.sh ;;
  down)      ./scripts/admission.sh down; rm -rf tmp ;;
  all)       scan_all && ./scripts/admission.sh all && ./scripts/consolidate.sh ;;
  *) echo "usage: ./run.sh [scan|admission|report|e2e|down|all]" >&2; exit 2 ;;
esac
