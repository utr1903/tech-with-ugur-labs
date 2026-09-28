#!/usr/bin/env bash
# Called by Terraform after the VM exists (07_bootstrap.tf). Pins the VM's
# SSH host key, waits for the boot script, pushes the lab files, builds the
# images, starts vLLM and returns only when the model answers.
set -euo pipefail

: "${LAB_INSTANCE_ID:?}" "${LAB_REGION:?}"
: "${MODEL_ID:?}" "${MODEL_REVISION:?}" "${SERVED_MODEL_NAME:?}" "${MAX_MODEL_LEN:?}" "${GPU_MEMORY_UTILIZATION:?}"
export LAB_INSTANCE_ID LAB_REGION

lab_dir="$(cd "$(dirname "$0")/.." && pwd)"
ssh_dir="$lab_dir/.ssh"
vm_ssh="$lab_dir/scripts/vm_ssh.sh"
step() { printf '\n==> %s\n' "$1"; }

step "Reading the VM's SSH host key from its console output"
mkdir -p "$ssh_dir"
: >"$ssh_dir/known_hosts"
rm -f "$ssh_dir/accept-new"
host_keys=""
for _ in $(seq 1 40); do
  host_keys="$(aws ec2 get-console-output --region "$LAB_REGION" --instance-id "$LAB_INSTANCE_ID" \
    --latest --output text --query Output 2>/dev/null \
    | sed -n '/-----BEGIN SSH HOST KEY KEYS-----/,/-----END SSH HOST KEY KEYS-----/p' \
    | grep -E '^(ssh-ed25519|ecdsa-sha2-nistp256) ' || true)"
  [ -n "$host_keys" ] && break
  sleep 15
done
if [ -n "$host_keys" ]; then
  while read -r type key _; do
    echo "$LAB_INSTANCE_ID $type $key" >>"$ssh_dir/known_hosts"
  done <<<"$host_keys"
  echo "Host key pinned from the console output."
else
  echo "The console output shows no host key; the first connection will accept it (through the authenticated tunnel)."
  touch "$ssh_dir/accept-new"
fi

step "Waiting for the boot script to finish"
booted=""
for _ in $(seq 1 80); do
  state="$("$vm_ssh" ssh 'if [ -f /var/lib/lab-boot/failed ]; then echo failed; elif [ -f /var/lib/lab-boot/done ]; then echo done; else echo waiting; fi' 2>/dev/null || echo unreachable)"
  case "$state" in
    done) booted=yes; break ;;
    failed)
      "$vm_ssh" ssh 'tail -n 40 /var/log/lab-boot.log' >&2 || true
      echo "The boot script failed; see the log above." >&2
      exit 1 ;;
  esac
  sleep 15
done
[ -n "$booted" ] || { echo "The VM did not finish booting within 20 minutes." >&2; exit 1; }
rm -f "$ssh_dir/accept-new"

step "Pushing the lab files"
# One folder at a time: a --delete sync of /srv/lab/ would wipe runs/.
"$vm_ssh" rsync-up "$lab_dir/vm/" /srv/lab/vm/
"$vm_ssh" rsync-up "$lab_dir/tasks/" /srv/lab/tasks/
"$vm_ssh" ssh "cat > /srv/lab/vm/.env" <<EOF
MODEL_ID=$MODEL_ID
MODEL_REVISION=$MODEL_REVISION
SERVED_MODEL_NAME=$SERVED_MODEL_NAME
MAX_MODEL_LEN=$MAX_MODEL_LEN
GPU_MEMORY_UTILIZATION=$GPU_MEMORY_UTILIZATION
VLLM_EXTRA_ARGS=${VLLM_EXTRA_ARGS:-}
EOF

step "Building the images and starting vLLM"
"$vm_ssh" ssh 'cd /srv/lab/vm && docker compose --profile tools build && docker compose up -d vllm'

step "Waiting until the model answers (the first start downloads about 80 GB)"
"$vm_ssh" ssh '/srv/lab/vm/bin/model-check.sh --wait 3600'

step "Ready. Next: make run TASK=log-summary"
