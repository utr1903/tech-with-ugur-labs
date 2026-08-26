#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
tf="$root/terraform"
stages=(01_foundation 02_iam 03_network 04_ingress 05_egress 06_workloads)

tunnel_pids=()
cleanup() {
  for pid in "${tunnel_pids[@]:-}"; do
    kill "$pid" 2>/dev/null || true
  done
}
trap cleanup EXIT

merge_config() {
  local tmp
  tmp="$(mktemp -d)"
  for stage in "${stages[@]}"; do
    terraform -chdir="$tf/$stage" output -json > "$tmp/$stage.json"
  done
  cat > "$tmp/extra.json" <<EOF
{
  "ssh_key_path": { "value": "$tf/06_workloads/ssh_key" },
  "tunnel_port_a": { "value": 10022 },
  "tunnel_port_b": { "value": 10023 },
  "allowed_domain": { "value": "github.com" },
  "denied_domain": { "value": "example.com" }
}
EOF
  jq -s 'add' "$tmp"/*.json > "$root/verifier-config.json"
  rm -rf "$tmp"
}

wait_for_port() {
  local port="$1"
  for _ in $(seq 1 30); do
    if (exec 3<>"/dev/tcp/127.0.0.1/$port") 2>/dev/null; then
      exec 3>&- || true
      return 0
    fi
    sleep 2
  done
  echo "IAP tunnel on port $port never came up" >&2
  return 1
}

echo "==> Exporting stage outputs to verifier-config.json"
merge_config

echo "==> Phase 1: the closed front door"
(cd "$root/verifier" && bun install --frozen-lockfile && bun src/index.ts --phase pre-allowlist --config "$root/verifier-config.json")

echo "==> Allowlisting this runner's IP at the edge (host-project apply)"
runner_ip="$(curl -fsS https://api.ipify.org)"
cat > "$tf/04_ingress/allowlist.auto.tfvars" <<EOF
allowlist_cidrs = ["$runner_ip/32"]
EOF
"$root/scripts/deploy_cloud.sh" --stage 04_ingress

echo "==> Opening IAP tunnels"
project_a="$(jq -r '.service_a_project_id.value' "$root/verifier-config.json")"
project_b="$(jq -r '.service_b_project_id.value' "$root/verifier-config.json")"
zone="$(jq -r '.vm_zone.value' "$root/verifier-config.json")"
vm_a="$(jq -r '.vm_name_a.value' "$root/verifier-config.json")"
vm_b="$(jq -r '.vm_name_b.value' "$root/verifier-config.json")"

gcloud compute start-iap-tunnel "$vm_a" 22 --local-host-port=localhost:10022 --zone "$zone" --project "$project_a" >/dev/null 2>&1 &
tunnel_pids+=($!)
gcloud compute start-iap-tunnel "$vm_b" 22 --local-host-port=localhost:10023 --zone "$zone" --project "$project_b" >/dev/null 2>&1 &
tunnel_pids+=($!)
wait_for_port 10022
wait_for_port 10023

echo "==> Phase 2: the full proof suite"
(cd "$root/verifier" && bun src/index.ts --phase post-allowlist --config "$root/verifier-config.json")

echo "==> All proofs passed"
