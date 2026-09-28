#!/usr/bin/env bash
# The only place that knows how to reach the VM. Each call creates a
# throwaway key, pushes it with EC2 Instance Connect (valid 60 seconds) and
# connects through the Instance Connect Endpoint tunnel. Nothing is written
# to ~/.ssh.
set -euo pipefail

usage() {
  cat >&2 <<'EOF'
usage: vm_ssh.sh ssh [-t] [command...]
       vm_ssh.sh rsync-up <local-path>... <remote-dir>
       vm_ssh.sh rsync-down <remote-path> <local-dir>
EOF
  exit 1
}

[ $# -ge 1 ] || usage
mode="$1"
shift
case "$mode" in
  ssh) ;;
  rsync-up) [ $# -ge 2 ] || usage ;;
  rsync-down) [ $# -eq 2 ] || usage ;;
  *) usage ;;
esac

lab_dir="$(cd "$(dirname "$0")/.." && pwd)"
ssh_dir="$lab_dir/.ssh"
mkdir -p "$ssh_dir"
touch "$ssh_dir/known_hosts"

tf_output() { terraform -chdir="$lab_dir/terraform" output -raw "$1"; }
instance_id="${LAB_INSTANCE_ID:-$(tf_output instance_id)}"
region="${LAB_REGION:-$(tf_output region)}"

# Strict host key checking against the key bootstrap read from the console.
# If the console did not show it, bootstrap leaves an accept-new marker.
host_key_checking="yes"
[ -f "$ssh_dir/accept-new" ] && host_key_checking="accept-new"

work_dir="$(mktemp -d)"
trap 'rm -rf "$work_dir"' EXIT
ssh-keygen -q -t ed25519 -N "" -C "lab-ephemeral" -f "$work_dir/key"

cat >"$work_dir/config" <<EOF
Host lab
  HostName $instance_id
  User ubuntu
  IdentityFile "$work_dir/key"
  IdentitiesOnly yes
  UserKnownHostsFile "$ssh_dir/known_hosts"
  StrictHostKeyChecking $host_key_checking
  HostKeyAlias $instance_id
  ServerAliveInterval 30
  ConnectTimeout 30
  LogLevel ERROR
  ProxyCommand aws ec2-instance-connect open-tunnel --region $region --instance-id %h
EOF

aws ec2-instance-connect send-ssh-public-key \
  --region "$region" \
  --instance-id "$instance_id" \
  --instance-os-user ubuntu \
  --ssh-public-key "file://$work_dir/key.pub" \
  --output text >/dev/null

status=0
case "$mode" in
  ssh)
    # A leading -t (terminal for interactive commands) goes before the host.
    tty_flag=()
    if [ "${1:-}" = "-t" ]; then tty_flag=(-t); shift; fi
    # ${a[@]+...} keeps an empty array safe under set -u in macOS's bash 3.2.
    ssh -F "$work_dir/config" ${tty_flag[@]+"${tty_flag[@]}"} lab "$@" || status=$?
    ;;
  rsync-up)
    dest="${*: -1}"
    # .env on the VM is written by bootstrap, never deleted by a sync.
    rsync -az --delete --exclude node_modules --exclude .DS_Store --exclude .env \
      -e "ssh -F $work_dir/config" "${@:1:$#-1}" "lab:$dest" || status=$?
    ;;
  rsync-down)
    rsync -az -e "ssh -F $work_dir/config" "lab:$1" "$2" || status=$?
    ;;
esac
exit "$status"
