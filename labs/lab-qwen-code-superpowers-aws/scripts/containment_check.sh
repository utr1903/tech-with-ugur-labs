#!/usr/bin/env bash
# Checks from outside and inside: nothing answers on the VM's public
# address, and the agent container holds no way into AWS.
set -uo pipefail
lab_dir="$(cd "$(dirname "$0")/.." && pwd)"
ip="$(terraform -chdir="$lab_dir/terraform" output -raw public_ip)"
failed=0

if curl -s --connect-timeout 5 --max-time 8 "http://$ip:8000/v1/models" >/dev/null; then
  echo "  FAIL  the model port answers on the public address"; failed=1
else
  echo "  ok    the model port is closed on the public address"
fi
if ssh -o BatchMode=yes -o ConnectTimeout=8 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null "ubuntu@$ip" true 2>/dev/null; then
  echo "  FAIL  SSH answers on the public address"; failed=1
else
  echo "  ok    SSH is unreachable on the public address"
fi

echo "Inside the agent container:"
"$lab_dir/scripts/vm_ssh.sh" ssh /srv/lab/vm/bin/containment-check.sh || failed=1
exit "$failed"
