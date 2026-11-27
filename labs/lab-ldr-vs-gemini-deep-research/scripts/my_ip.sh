#!/usr/bin/env bash
# Prints this machine's public IPv4 address as a /32, ready to paste into
# terraform.tfvars as allowed_ssh_cidr.
set -euo pipefail

ip="$(curl -fsS --max-time 10 https://checkip.amazonaws.com)" || { echo "my_ip: could not reach checkip.amazonaws.com" >&2; exit 1; }
ip="$(printf '%s' "$ip" | tr -d '[:space:]')"
octet='(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])'
if ! [[ "$ip" =~ ^$octet\.$octet\.$octet\.$octet$ ]]; then
  echo "my_ip: the answer is not an IPv4 address: '$ip'" >&2
  exit 1
fi
echo "$ip/32"
