#!/usr/bin/env bash
# After destroy: searches the Region for anything still tagged with the lab
# name. Fails loudly if something survived.
set -euo pipefail

region="${REGION:-eu-central-1}"
lab="qwen-code-superpowers-aws"
tag_filter="Name=tag:lab,Values=$lab"
found=0

check() {
  local label="$1" ids="$2"
  if [ -n "$ids" ] && [ "$ids" != "None" ]; then
    printf '  LEFT  %s: %s\n' "$label" "$ids"
    found=1
  else
    printf '  gone  %s\n' "$label"
  fi
}

check "instances" "$(aws ec2 describe-instances --region "$region" \
  --filters "$tag_filter" Name=instance-state-name,Values=pending,running,shutting-down,stopping,stopped \
  --query 'Reservations[].Instances[].InstanceId' --output text)"
check "volumes" "$(aws ec2 describe-volumes --region "$region" --filters "$tag_filter" \
  --query 'Volumes[].VolumeId' --output text)"
check "instance connect endpoints" "$(aws ec2 describe-instance-connect-endpoints --region "$region" \
  --filters "$tag_filter" \
  --query "InstanceConnectEndpoints[?State!='delete-complete'].InstanceConnectEndpointId" \
  --output text)" # single-quoted JMESPath raw string, not a shell/command-substitution backtick (avoids SC2016)
check "security groups" "$(aws ec2 describe-security-groups --region "$region" --filters "$tag_filter" \
  --query 'SecurityGroups[].GroupId' --output text)"
check "VPCs" "$(aws ec2 describe-vpcs --region "$region" --filters "$tag_filter" \
  --query 'Vpcs[].VpcId' --output text)"
check "elastic IPs" "$(aws ec2 describe-addresses --region "$region" --filters "$tag_filter" \
  --query 'Addresses[].AllocationId' --output text)"

if [ "$found" -ne 0 ]; then
  echo "Some resources survived the destroy. Delete them in the console or re-run make destroy." >&2
  exit 1
fi
echo "Nothing left behind."
