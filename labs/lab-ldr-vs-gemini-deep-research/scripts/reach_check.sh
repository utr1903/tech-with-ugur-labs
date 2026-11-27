#!/usr/bin/env bash
# Proves the model is reachable only through the tunnel: it answers on the
# laptop's loopback, never on the VM's public address, and the lab's own
# in-network checks pass. Each check reports ok/FAIL; the exit is non-zero
# if any failed.
set -uo pipefail

lab_dir="$(cd "$(dirname "$0")/.." && pwd)"
failed=0
ok() { printf '  ok    %s\n' "$1"; }
bad() { printf '  FAIL  %s\n' "$1"; failed=1; }

# 1. Through the tunnel.
if curl -fsS --max-time 5 http://127.0.0.1:8000/v1/models >/dev/null; then
  ok "the model answers through the tunnel"
else
  bad "the model does not answer on 127.0.0.1:8000 (run scripts/tunnel.sh open)"
fi

# 2. On the public address: only "connection refused" (7) or a timeout (28)
# count as closed. Any HTTP response, or any other outcome, is a FAIL.
ip="${LAB_PUBLIC_IP:-}"
if [ -z "$ip" ]; then
  ip="$(terraform -chdir="$lab_dir/terraform" output -raw public_ip 2>/dev/null)" || ip=""
fi
if [ -z "$ip" ]; then
  bad "could not read the VM's public IP (terraform output public_ip); cannot check the public address"
else
  rc=0
  curl -sS --max-time 5 -o /dev/null "http://$ip:8000/v1/models" 2>/dev/null || rc=$?
  case "$rc" in
    7 | 28) ok "model port is closed on the public address" ;;
    0) bad "the model port answers over HTTP on the public address $ip" ;;
    *) bad "unexpected result (curl exit $rc) probing the public address $ip; expected connection refused or timeout" ;;
  esac
fi

# 3. The in-network checks.
if (cd "$lab_dir" && docker compose run --rm --build bench check); then
  ok "in-network checks passed"
else
  bad "in-network checks failed (docker compose run --rm --build bench check)"
fi

exit "$failed"
