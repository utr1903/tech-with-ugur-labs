#!/usr/bin/env bash
# Lints and renders the chart, then asserts the deliberately insecure settings are present.
set -euo pipefail
chart="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$chart"

helm lint . --set image.repository=x --set image.tag=y --set dataBucket=b >/dev/null
out="$(helm template chatbot-server . -n chatbot --set image.repository=x --set image.tag=y --set dataBucket=b)"

fail=0
must() { grep -qE -- "$1" <<< "$out" || { echo "missing: $1" >&2; fail=1; }; }
mustnot() { ! grep -qE -- "$1" <<< "$out" || { echo "unexpected: $1" >&2; fail=1; }; }

sa_doc="$(awk 'BEGIN{RS="\n---\n"} /(^|\n)kind: ServiceAccount/ {print}' <<< "$out")"
grep -qE '^  name: chatbot-server$' <<< "$sa_doc" || { echo "missing: ServiceAccount named chatbot-server" >&2; fail=1; }
must 'automountServiceAccountToken: true'
must 'privileged: true'
must 'runAsUser: 0'
must 'allowPrivilegeEscalation: true'
must 'NET_ADMIN'
must 'SYS_ADMIN'
must 'hostPID: true'
must 'hostPath:'
must 'path: /var/log'
must 'type: LoadBalancer'
must '^[[:space:]]+port: 80$'
must 'targetPort: 8080'
must 'imagePullPolicy: Always'
must 'path: /healthz'
must 'livenessProbe:'
must 'readinessProbe:'
must 'DATA_BUCKET'
must 'name: AIKIDO_TOKEN'
must 'secretKeyRef:'
mustnot 'resources:'
mustnot 'kind: NetworkPolicy'

[[ $fail -eq 0 ]] || exit 1
echo "chart OK"
