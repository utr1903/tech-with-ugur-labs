#!/usr/bin/env bash
# Lints and renders the wrapper chart, then asserts image scanning and runtime detection are on.
set -euo pipefail
chart="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$chart"

helm dependency build . >/dev/null 2>&1 || helm dependency update . >/dev/null
helm lint . --set kubernetes-agent.config.apiToken=x >/dev/null
out="$(helm template aikido . -n aikido --set kubernetes-agent.config.apiToken=x)"

fail=0
must() { grep -qE -- "$1" <<< "$out" || { echo "missing: $1" >&2; fail=1; }; }

must 'name: aikido-kubernetes-agent-sbom-collector'
must 'name: aikido-kubernetes-agent-runtime-detection$'
must 'kind: DaemonSet'
must 'public.ecr.aws/aikido-cloud/falco'
must 'modern_ebpf'
# Falco must post to the agent's in-cluster service under this release name.
must 'http://aikido-kubernetes-agent:8241/detection'

[[ $fail -eq 0 ]] || exit 1
echo "chart OK"
