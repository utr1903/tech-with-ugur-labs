#!/usr/bin/env bash
set -euo pipefail
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
source "$script_dir/platform.sh"
for architecture in amd64 x86_64 arm64 aarch64; do
  select_platform "$architecture"
  case "$architecture" in
    amd64|x86_64)
      test "$artifact_arch" = x86_64
      test "$pod_subnet" = 192.168.0.0/16
      test "$python_digest" = 2986c55feb36e6cae00fa1fefb454283e4b33f35e75ff8bdd123b134130be301
      cmp "$script_dir/runtime.sha256" "$script_dir/runtime-x86_64.sha256"
      cmp "$script_dir/kind.yaml" <(render_manifest "$script_dir/kind.yaml")
      cmp "$script_dir/python-job.yaml" <(render_manifest "$script_dir/python-job.yaml")
      ;;
    *)
      test "$artifact_arch" = aarch64
      test "$pod_subnet" = 10.244.0.0/16
      render_manifest "$script_dir/kind.yaml" | grep -q 10.244.0.0/16
      render_manifest "$script_dir/python-job.yaml" | grep -q 228390eced221ad2986a3dd77e10b1accca6ba8ceb36f1572de1b346a337cc1a
      ;;
  esac
done
if (select_platform riscv64); then exit 1; fi
printf 'PASS: fixed architecture allowlist and manifest pins\n'
