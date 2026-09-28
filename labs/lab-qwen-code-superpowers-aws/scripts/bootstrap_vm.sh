#!/usr/bin/env bash
# Called by Terraform after the VM exists (07_bootstrap.tf). Pins the VM's
# SSH host key, waits for the boot script, pushes the lab files, builds the
# images, starts vLLM and returns only when the model answers.
set -euo pipefail

: "${LAB_INSTANCE_ID:?}" "${LAB_REGION:?}"
: "${MODEL_ID:?}" "${MODEL_REVISION:?}" "${SERVED_MODEL_NAME:?}" "${MAX_MODEL_LEN:?}" "${GPU_MEMORY_UTILIZATION:?}" "${MAX_NUM_SEQS:?}"
export LAB_INSTANCE_ID LAB_REGION

lab_dir="$(cd "$(dirname "$0")/.." && pwd)"
ssh_dir="$lab_dir/.ssh"
vm_ssh="$lab_dir/scripts/vm_ssh.sh"
step() { printf '\n==> %s\n' "$1"; }

console_output() {
  aws ec2 get-console-output --region "$LAB_REGION" --instance-id "$LAB_INSTANCE_ID" \
    --latest --output text --query Output
}

# Polls the console output for the VM's SSH host key. Sets globals:
# host_keys (the matched lines, empty if none yet), aws_status (exit status
# of the last `aws` call) and aws_last_err (its stderr, only when it failed).
# Retry count and sleep are overridable so a test can run this fast.
poll_console_host_key() {
  local retries="${LAB_BOOTSTRAP_HOSTKEY_RETRIES:-40}"
  local wait_seconds="${LAB_BOOTSTRAP_HOSTKEY_SLEEP:-15}"
  local aws_err_file raw i=0
  aws_err_file="$(mktemp)"
  host_keys=""
  aws_status=0
  aws_last_err=""
  while [ "$i" -lt "$retries" ]; do
    i=$((i + 1))
    # `&&`/`||` (not a bare assignment) so a failing aws call is "tested"
    # and does not trip set -e before aws_status can be read below.
    raw="$(console_output 2>"$aws_err_file")" && aws_status=0 || aws_status=$?
    if [ "$aws_status" -eq 0 ]; then
      aws_last_err=""
      host_keys="$(printf '%s\n' "$raw" \
        | sed -n '/-----BEGIN SSH HOST KEY KEYS-----/,/-----END SSH HOST KEY KEYS-----/p' \
        | grep -E '^(ssh-ed25519|ecdsa-sha2-nistp256) ' || true)"
      [ -n "$host_keys" ] && break
    else
      aws_last_err="$(cat "$aws_err_file" 2>/dev/null)"
    fi
    [ "$i" -lt "$retries" ] && sleep "$wait_seconds"
  done
  rm -f "$aws_err_file"
}

step "Reading the VM's SSH host key from its console output"
mkdir -p "$ssh_dir"
: >"$ssh_dir/known_hosts"
rm -f "$ssh_dir/accept-new"
poll_console_host_key
if [ -n "$host_keys" ]; then
  while read -r key_type key _; do
    echo "$LAB_INSTANCE_ID $key_type $key" >>"$ssh_dir/known_hosts"
  done <<<"$host_keys"
  echo "Host key pinned from the console output."
elif [ "$aws_status" -ne 0 ]; then
  echo "Reading the VM's SSH host key from its console output: aws ec2 get-console-output kept failing." >&2
  echo "Last AWS error: $aws_last_err" >&2
  exit 1
else
  echo "The console output shows no host key; the first connection will accept it (through the authenticated tunnel)."
  touch "$ssh_dir/accept-new"
fi

step "Waiting for the boot script to finish"
booted=""
last_ssh_err=""
boot_retries="${LAB_BOOTSTRAP_BOOTWAIT_RETRIES:-80}"
boot_wait_seconds="${LAB_BOOTSTRAP_BOOTWAIT_SLEEP:-15}"
i=0
while [ "$i" -lt "$boot_retries" ]; do
  i=$((i + 1))
  ssh_err_file="$(mktemp)"
  if state="$("$vm_ssh" ssh 'if [ -f /var/lib/lab-boot/failed ]; then echo failed; elif [ -f /var/lib/lab-boot/done ]; then echo done; else echo waiting; fi' 2>"$ssh_err_file")"; then
    last_ssh_err=""
  else
    state="unreachable"
    last_ssh_err="$(cat "$ssh_err_file" 2>/dev/null)"
  fi
  rm -f "$ssh_err_file"
  case "$state" in
    done) booted=yes; break ;;
    failed)
      "$vm_ssh" ssh 'tail -n 40 /var/log/lab-boot.log' >&2 || true
      echo "The boot script failed; see the log above." >&2
      exit 1 ;;
  esac
  [ "$i" -lt "$boot_retries" ] && sleep "$boot_wait_seconds"
done
if [ -z "$booted" ]; then
  echo "Waiting for the boot script to finish: the VM did not finish booting within 20 minutes." >&2
  if [ -n "$last_ssh_err" ]; then
    echo "Last ssh error: $last_ssh_err" >&2
  fi
  echo "Last 40 lines of the instance console output:" >&2
  console_output 2>&1 | tail -n 40 >&2 || true
  echo "Last 40 lines of /var/log/lab-boot.log, if the VM is reachable:" >&2
  "$vm_ssh" ssh 'tail -n 40 /var/log/lab-boot.log' >&2 || true
  exit 1
fi
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
MAX_NUM_SEQS=$MAX_NUM_SEQS
SERVE_EXTRA_ARGS=${SERVE_EXTRA_ARGS:-}
EOF

step "Building the images and starting vLLM"
"$vm_ssh" ssh 'cd /srv/lab/vm && docker compose --profile tools build && docker compose up -d vllm'

step "Waiting until the model answers (the first start downloads about 80 GB)"
"$vm_ssh" ssh '/srv/lab/vm/bin/model-check.sh --wait 3600'

step "Ready. Next: make run TASK=log-summary"
