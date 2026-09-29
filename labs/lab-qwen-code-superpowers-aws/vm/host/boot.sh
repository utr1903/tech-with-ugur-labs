#!/usr/bin/env bash
# Runs once as root through cloud-init. Checks that the AMI brings what the
# lab needs, moves Docker's data and the model cache to the local NVMe, and
# leaves a marker that bootstrap waits for.
set -euo pipefail

mkdir -p /var/lib/lab-boot
exec > >(tee -a /var/log/lab-boot.log) 2>&1

fail() {
  # Disarm the ERR trap first: fail's own commands must not recurse into it.
  trap - ERR
  echo "LAB-BOOT-FAILED: $*"
  echo "$*" >/var/lib/lab-boot/failed
  exit 1
}
# Catches any unguarded command that dies under set -e (systemctl, install,
# usermod, apt-get, the daemon.json edit) so the failed marker always gets
# written, not just the explicitly-checked commands below.
trap 'fail "boot step failed (line $LINENO): $BASH_COMMAND"' ERR

echo "Waiting for the instance-store NVMe at /opt/dlami/nvme..."
for _ in $(seq 1 60); do
  mountpoint -q /opt/dlami/nvme && break
  sleep 5
done
mountpoint -q /opt/dlami/nvme || fail "the instance-store NVMe is not mounted at /opt/dlami/nvme"

command -v docker >/dev/null || fail "Docker is not installed on this AMI"
dpkg -s ec2-instance-connect >/dev/null 2>&1 || fail "ec2-instance-connect is not installed on this AMI"
command -v nvidia-smi >/dev/null || fail "the NVIDIA driver is missing"

apt_packages=()
docker compose version >/dev/null 2>&1 || apt_packages+=(docker-compose-v2)
command -v rsync >/dev/null || apt_packages+=(rsync)
command -v tmux >/dev/null || apt_packages+=(tmux)
if [ "${#apt_packages[@]}" -gt 0 ]; then
  echo "Installing ${apt_packages[*]}..."
  apt-get update -q
  DEBIAN_FRONTEND=noninteractive apt-get install -y -q "${apt_packages[@]}"
fi

echo "Moving containerd's image store to the NVMe..."
# This AMI's Docker uses the containerd image store (containerd's own
# "root", not Docker's data-root below), so images land under
# /var/lib/containerd on the root volume unless we move it first -- and
# it must happen before the data-root move and before any image exists.
systemctl stop docker docker.socket containerd
mkdir -p /opt/dlami/nvme/containerd
python3 - <<'PY'
import pathlib
import re

path = pathlib.Path("/etc/containerd/config.toml")
text = path.read_text()
new_root = 'root = "/opt/dlami/nvme/containerd"'
# Match the top-level root line however it currently reads -- commented
# default, already applied by a previous boot, or any other value -- so
# a second boot replaces it in place instead of adding a second one
# (containerd rejects a config with the same key twice). Anchored at
# column 0 so a nested "root = ..." inside a proxy_plugins table (e.g.
# the SOCI snapshotter), which is indented, is never touched, and any
# NVIDIA runtime section elsewhere in the file is left alone too.
top_level_root = re.compile(r'(?m)^#?root\s*=.*$')
if top_level_root.search(text):
    text = top_level_root.sub(new_root, text, count=1)
else:
    text = re.sub(r'(?m)^(disabled_plugins = .*)$', r'\1\n' + new_root, text, count=1)
path.write_text(text)
PY
systemctl start containerd
# containerd's own TOML encoder quotes strings with ' or " depending on
# version (seen both across containerd releases), so accept either.
containerd_root="$(containerd config dump 2>/dev/null | sed -nE "s/^root = [\"']([^\"']*)[\"']\$/\1/p")"
[ "$containerd_root" = "/opt/dlami/nvme/containerd" ] ||
  fail "containerd did not pick up the new root dir after editing /etc/containerd/config.toml"

echo "Moving Docker's data root to the NVMe..."
mkdir -p /opt/dlami/nvme/docker /opt/dlami/nvme/hf-cache
python3 - <<'PY'
import json, pathlib
path = pathlib.Path("/etc/docker/daemon.json")
config = json.loads(path.read_text()) if path.exists() else {}
config["data-root"] = "/opt/dlami/nvme/docker"
path.write_text(json.dumps(config, indent=2))
PY
systemctl start docker
runtimes="$(docker info --format '{{json .Runtimes}}')" ||
  fail "docker did not respond after moving its data root to the NVMe (check that the daemon restarted and /etc/docker/daemon.json is valid)"
echo "$runtimes" | grep -q nvidia || fail "the NVIDIA container runtime is not registered with Docker"

install -d -o ubuntu -g ubuntu /srv/lab /srv/lab/runs /srv/lab/scratch
usermod -aG docker ubuntu

echo "Boot preparation finished."
touch /var/lib/lab-boot/done
