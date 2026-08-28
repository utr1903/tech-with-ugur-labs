#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "usage: $0 --stage <stage-dir> [--dry-run] [--destroy]" >&2
  exit 1
}

stage=""
dry_run=false
destroy=false
while [ $# -gt 0 ]; do
  case "$1" in
    --stage)
      shift
      [ $# -gt 0 ] || usage
      stage="$1"
      ;;
    --dry-run) dry_run=true ;;
    --destroy) destroy=true ;;
    *) usage ;;
  esac
  shift
done
[ -n "$stage" ] || usage

tf_dir="$(cd "$(dirname "$0")/../terraform/$stage" && pwd)"
terraform -chdir="$tf_dir" init -input=false

if $dry_run && $destroy; then
  terraform -chdir="$tf_dir" plan -destroy
elif $dry_run; then
  terraform -chdir="$tf_dir" plan
elif $destroy; then
  terraform -chdir="$tf_dir" destroy -auto-approve
else
  terraform -chdir="$tf_dir" apply -auto-approve
fi
