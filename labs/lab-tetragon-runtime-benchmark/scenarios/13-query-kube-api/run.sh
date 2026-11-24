#!/bin/sh
# Use the pod's service-account token to talk to the Kubernetes API. The
# account has no RBAC, so a 403 is the expected answer: what matters is that
# the request reached the API server at all.
mkdir -p /tmp/bench || exit 1
echo "BENCH_ACTION $(date +%s%3N)"
token="$(cat /var/run/secrets/kubernetes.io/serviceaccount/token)"
curl -sk -o /dev/null -w '%{http_code}' --max-time 5 \
  -H "Authorization: Bearer $token" \
  https://kubernetes.default.svc/api > /tmp/bench/13.out
