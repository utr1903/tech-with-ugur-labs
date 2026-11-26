#!/usr/bin/env bash
# The only place that knows how to reach the VM. Each connection creates a
# throwaway key, pushes it with EC2 Instance Connect (valid 60 seconds) and
# connects straight to the VM's public address; the security group admits
# only your IP. Nothing is written to ~/.ssh.
set -euo pipefail

usage() {
  cat >&2 <<'USAGE'
usage: vm_ssh.sh ssh [-t] [command...]
       vm_ssh.sh rsync-up <local-path>... <remote-dir>
       vm_ssh.sh tunnel-open | tunnel-close | tunnel-status
USAGE
  exit 1
}

[ $# -ge 1 ] || usage
mode="$1"
shift
case "$mode" in
  ssh) ;;
  rsync-up) [ $# -ge 2 ] || usage ;;
  tunnel-open | tunnel-close | tunnel-status) [ $# -eq 0 ] || usage ;;
  *) usage ;;
esac

lab_dir="$(cd "$(dirname "$0")/.." && pwd)"
ssh_dir="$lab_dir/.ssh"
# A short, stable path used by open, check and exit alike. The lab's own
# directory can be too deep: Unix socket paths are limited to about 104
# bytes on macOS, and OpenSSH first binds "<path>.<16 random characters>".
sock_dir="${TMPDIR:-/tmp}"
sock_dir="${sock_dir%/}"
sock="$sock_dir/ldr-$(printf '%s' "$lab_dir" | shasum | cut -c1-12).sock"
mkdir -p "$ssh_dir"

# The tunnel's control socket is only ever asked, never given a key.
case "$mode" in
  tunnel-close)
    ssh -F /dev/null -S "$sock" -O exit lab
    exit $?
    ;;
  tunnel-status)
    ssh -F /dev/null -S "$sock" -O check lab
    exit $?
    ;;
esac

touch "$ssh_dir/known_hosts"

tf_output() { terraform -chdir="$lab_dir/terraform" output -raw "$1"; }
instance_id="${LAB_INSTANCE_ID:-$(tf_output instance_id)}"
region="${LAB_REGION:-$(tf_output region)}"
public_ip="${LAB_PUBLIC_IP:-$(tf_output public_ip)}"
[ -n "$instance_id" ] && [ -n "$public_ip" ] || { echo "vm_ssh: no instance id or public IP; is the lab deployed?" >&2; exit 1; }

if [ "$mode" = "tunnel-open" ]; then
  if [ "${#sock}" -gt 86 ]; then
    echo "vm_ssh: tunnel-open: the socket path is too long (${#sock} characters): $sock" >&2
    echo "Set TMPDIR to a shorter directory and retry." >&2
    exit 1
  fi
  # A leftover socket from a dead master blocks a new one.
  if [ -S "$sock" ] && ! ssh -F /dev/null -S "$sock" -O check lab >/dev/null 2>&1; then
    rm -f "$sock"
  fi
  if (exec 3<>/dev/tcp/127.0.0.1/8000) 2>/dev/null; then
    echo "vm_ssh: tunnel-open: 127.0.0.1:8000 is already in use by another process; stop it and retry." >&2
    exit 1
  fi
fi

# Strict host key checking against the key bootstrap read from the console.
# If the console did not show it, bootstrap leaves an accept-new marker.
host_key_checking="yes"
[ -f "$ssh_dir/accept-new" ] && host_key_checking="accept-new"

work_dir="$(mktemp -d)"
# Only the key directory goes; a backgrounded tunnel master must survive.
trap 'rm -rf "$work_dir"' EXIT
ssh-keygen -q -t ed25519 -N "" -C "lab-ephemeral" -f "$work_dir/key"

cat >"$work_dir/config" <<CONFIG
Host lab
  HostName $public_ip
  User ubuntu
  IdentityFile "$work_dir/key"
  IdentitiesOnly yes
  UserKnownHostsFile "$ssh_dir/known_hosts"
  StrictHostKeyChecking $host_key_checking
  HostKeyAlias $instance_id
  ServerAliveInterval 30
  ConnectTimeout 30
  LogLevel ERROR
CONFIG

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
    rsync -az --delete --exclude .DS_Store --exclude .env \
      -e "ssh -F \"$work_dir/config\"" "${@:1:$#-1}" "lab:$dest" || status=$?
    ;;
  tunnel-open)
    # The master authenticates once, then lives on without the key.
    ssh -F "$work_dir/config" -f -N -M -S "$sock" \
      -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=4 \
      -L 127.0.0.1:8000:127.0.0.1:8000 lab || status=$?
    ;;
esac
exit "$status"
