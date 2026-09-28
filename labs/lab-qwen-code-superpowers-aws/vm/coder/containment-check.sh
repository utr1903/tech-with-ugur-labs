#!/usr/bin/env bash
# Run inside the coder container: proves the agent's sandbox holds no cloud
# credentials and cannot reach instance metadata or the Docker daemon.
set -uo pipefail
failed=0
ok() { printf '  ok    %s\n' "$1"; }
bad() { printf '  FAIL  %s\n' "$1"; failed=1; }

if node -e 'fetch("http://169.254.169.254/latest/api/token",{method:"PUT",headers:{"X-aws-ec2-metadata-token-ttl-seconds":"60"},signal:AbortSignal.timeout(3000)}).then(()=>process.exit(0),()=>process.exit(1))'; then
  bad "instance metadata is reachable"
else
  ok "instance metadata is unreachable"
fi
if env | grep -qE '^AWS_'; then bad "AWS_* variables are set"; else ok "no AWS_* variables"; fi
if [ -e "$HOME/.aws" ]; then bad "$HOME/.aws exists"; else ok "no $HOME/.aws"; fi
if [ -S /var/run/docker.sock ]; then bad "the Docker socket is mounted"; else ok "no Docker socket"; fi
if [ "$(id -u)" -eq 0 ]; then bad "running as root"; else ok "running as uid $(id -u)"; fi
if touch /usr/local/probe 2>/dev/null; then bad "the root filesystem is writable"; else ok "the root filesystem is read-only"; fi
if touch /workspace/.probe 2>/dev/null; then rm -f /workspace/.probe; ok "the workspace is writable"; else bad "the workspace is not writable"; fi
exit "$failed"
