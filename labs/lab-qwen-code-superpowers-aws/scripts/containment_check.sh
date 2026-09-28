#!/usr/bin/env bash
# Checks from outside and inside: nothing answers on the VM's public
# address, and the agent container holds no way into AWS.
# set -u (not -e): a failing check must not abort the checks after it; each
# one reports its own ok/FAIL and `failed` accumulates across all of them.
set -uo pipefail
lab_dir="$(cd "$(dirname "$0")/.." && pwd)"
ip="${LAB_CONTAINMENT_HOST:-$(terraform -chdir="$lab_dir/terraform" output -raw public_ip)}"
model_port="${LAB_CONTAINMENT_MODEL_PORT:-8000}"
ssh_port="${LAB_CONTAINMENT_SSH_PORT:-22}"
failed=0

# A TCP-level connect, not an HTTP or SSH handshake: SSH answers
# "Permission denied" on an open port even with no key sent, which a full
# `ssh` attempt cannot tell apart from "port closed". %{time_connect} is
# 0 (curl never got a TCP connection: refused, filtered, or timed out) or
# a positive number of seconds (the handshake completed: the port is open).
port_open() {
  local time_connect
  time_connect="$(curl -s -o /dev/null -w '%{time_connect}' \
    --connect-timeout 5 --max-time 6 "telnet://$1:$2" </dev/null)"
  awk -v t="${time_connect:-0}" 'BEGIN{exit !(t>0)}'
}

if port_open "$ip" "$model_port"; then
  echo "  FAIL  the model port answers on the public address"; failed=1
else
  echo "  ok    the model port is closed on the public address"
fi
if port_open "$ip" "$ssh_port"; then
  echo "  FAIL  SSH answers on the public address"; failed=1
else
  echo "  ok    SSH is unreachable on the public address"
fi

echo "Inside the agent container:"
"$lab_dir/scripts/vm_ssh.sh" ssh /srv/lab/vm/bin/containment-check.sh || failed=1
exit "$failed"
