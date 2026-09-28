#!/usr/bin/env bash
# Runs once as root through cloud-init. Checks that the AMI brings what the
# lab needs, moves Docker's data and the model cache to the local NVMe, and
# leaves a marker that bootstrap waits for.
set -euo pipefail

mkdir -p /var/lib/lab-boot
exec > >(tee -a /var/log/lab-boot.log) 2>&1

fail() {
  echo "LAB-BOOT-FAILED: $*"
  echo "$*" >/var/lib/lab-boot/failed
  exit 1
}

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

echo "Moving Docker's data root to the NVMe..."
systemctl stop docker docker.socket
mkdir -p /opt/dlami/nvme/docker /opt/dlami/nvme/hf-cache
python3 - <<'PY'
import json, pathlib
path = pathlib.Path("/etc/docker/daemon.json")
config = json.loads(path.read_text()) if path.exists() else {}
config["data-root"] = "/opt/dlami/nvme/docker"
path.write_text(json.dumps(config, indent=2))
PY
systemctl start docker
docker info --format '{{json .Runtimes}}' | grep -q nvidia || fail "the NVIDIA container runtime is not registered with Docker"

install -d -o ubuntu -g ubuntu /srv/lab /srv/lab/runs /srv/lab/scratch
usermod -aG docker ubuntu

echo "Boot preparation finished."
touch /var/lib/lab-boot/done
