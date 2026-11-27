#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "usage: $0 [--dry-run] [--destroy]" >&2
  exit 1
}

dry_run=false
destroy=false
for arg in "$@"; do
  case "$arg" in
    --dry-run) dry_run=true ;;
    --destroy) destroy=true ;;
    *) usage ;;
  esac
done

tf_dir="$(cd "$(dirname "$0")/../terraform" && pwd)"
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
