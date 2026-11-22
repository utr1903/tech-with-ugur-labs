#!/usr/bin/env bash
# Tears down everything deploy.sh created: Helm releases, Aikido demo clouds, AWS (Terraform).
# Tolerates partial deploys and "already gone"; independent steps keep running after a failure.
set -euo pipefail

# shellcheck source-path=SCRIPTDIR source=lib/aikido.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/aikido.sh"

CLUSTER_NAME="aikido-demo-eks"
REGION="eu-central-1"
CLUSTER_PRESENT=0
ERRORS=()

usage() {
  cat << 'EOF'
Usage: scripts/destroy.sh (or: make destroy) [--yes]

Removes the Aikido demo: Helm releases, the aikido-demo-* Aikido clouds (AWS, EKS, GCP) and all
Terraform-managed resources (AWS and both GCP projects). Aikido registries can't be removed via API;
the script names them so you can remove them in the UI.
Safe to run repeatedly and after a failed deploy.

  --yes   don't ask for confirmation
  --help  show this help
EOF
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --yes) export ASSUME_YES=1 ;;
      -h | --help)
        usage
        exit 0
        ;;
      *)
        usage >&2
        die "unknown argument: $1"
        ;;
    esac
    shift
  done
}

# run_step NAME FN: runs FN in a subshell; a failure is recorded and the script continues.
run_step() {
  local name="$1"
  shift
  log_step "$name"
  if ! ("$@"); then
    log_warn "step failed: $name"
    ERRORS+=("$name")
  fi
}

step_preflight() {
  # gcloud is only needed for the GCP leftover listing, so a machine without it can still destroy.
  OPTIONAL_TOOLS="gcloud" require_tools
  load_env
  require_tfvars
  aws_preflight
  local deployed_at
  deployed_at="$(state_get deployed_at)"
  [[ -z "$deployed_at" ]] || log_info "environment was up for $(minutes_since "$deployed_at") minutes (since $deployed_at)"
  confirm "Destroy the Aikido demo (AWS resources, aikido-demo-* Aikido clouds, and both GCP demo projects aikido-demo-dev-* / aikido-demo-prod-*, which get deleted)?"
}

# Terraform needs the variable even for destroy; its value doesn't matter there.
set_external_id() {
  local ws=""
  if [[ -n "${AIKIDO_EXTERNAL_ID:-}" ]]; then
    TF_VAR_aikido_external_id="$AIKIDO_EXTERNAL_ID"
  elif ws="$(aikido_workspace_id 2> /dev/null)" && [[ -n "$ws" && "$ws" != "null" ]]; then
    TF_VAR_aikido_external_id="aikido-$ws"
  else
    log_warn "Aikido API unavailable; using placeholder external ID for terraform destroy"
    TF_VAR_aikido_external_id="aikido-0"
  fi
  export TF_VAR_aikido_external_id
}

step_kubeconfig() {
  export KUBECONFIG="$STATE_DIR/kubeconfig"
  if aws eks describe-cluster --name "$CLUSTER_NAME" --region "$REGION" > /dev/null 2>&1; then
    mkdir -p "$STATE_DIR"
    aws eks update-kubeconfig --name "$CLUSTER_NAME" --region "$REGION" --kubeconfig "$KUBECONFIG" > /dev/null
    return 0
  fi
  return 1
}

_uninstall() {
  local release="$1" ns="$2"
  if helm status "$release" -n "$ns" > /dev/null 2>&1; then
    helm uninstall "$release" -n "$ns" --wait --timeout 5m
  else
    log_info "release $release not installed"
  fi
}

_vpc_id() {
  aws ec2 describe-vpcs --region "$REGION" --filters "Name=tag:Name,Values=aikido-demo-vpc" \
    --query 'Vpcs[0].VpcId' --output text 2> /dev/null
}

# Load balancers (classic and v2) left in the demo VPC.
_lbs_in_vpc() {
  local vpc="$1"
  aws elb describe-load-balancers --region "$REGION" \
    --query "LoadBalancerDescriptions[?VPCId=='$vpc'].LoadBalancerName" --output text
  aws elbv2 describe-load-balancers --region "$REGION" \
    --query "LoadBalancers[?VpcId=='$vpc'].LoadBalancerName" --output text
}

step_chatbot() {
  _uninstall chatbot-server chatbot
  local vpc lbs i
  vpc="$(_vpc_id)"
  [[ -n "$vpc" && "$vpc" != "None" ]] || return 0
  log_info "waiting for load balancers in $vpc to be deleted"
  for ((i = 0; i < 60; i++)); do
    lbs="$(_lbs_in_vpc "$vpc" | tr -s '[:space:]' ' ' | sed 's/^ *//; s/ *$//')"
    [[ -z "$lbs" ]] && return 0
    sleep 10
  done
  log_warn "load balancers still present after 10 minutes: $lbs"
  return 1
}

step_agent() { _uninstall aikido aikido; }

step_aikido_clouds() {
  aikido_token > /dev/null || return 1
  local ids=() id rc=0 seen=" "
  local env name
  ids+=("$(state_get aws_cloud_id)" "$(state_get k8s_cloud_id)")
  ids+=("$(aikido_find_cloud_by_name aikido-demo-aws)") || return 1
  ids+=("$(aikido_find_cloud_by_name aikido-demo-eks)") || return 1
  for env in $(gcp_envs); do
    ids+=("$(state_get "gcp_${env}_cloud_id")")
    name="$(aikido_find_cloud_by_name "aikido-demo-gcp-$env")" || return 1
    ids+=("$name")
  done
  for id in "${ids[@]}"; do
    [[ -z "$id" || "$seen" == *" $id "* ]] && continue
    seen="$seen$id "
    if ! aikido_delete_cloud "$id"; then
      log_warn "could not delete Aikido cloud $id; if VM scanning is on, delete cloud $id in the Aikido UI"
      rc=1
    fi
  done
  return "$rc"
}

# Aikido has no API to remove container registries; name the ones that still exist.
step_gcp_registries() {
  local env id
  for env in $(gcp_envs); do
    id="$(state_get "gcp_${env}_registry_id")"
    [[ -n "$id" ]] || continue
    if aikido_registry_exists "$id"; then
      log_warn "Aikido registry $id (GCP $env) can't be removed via API; remove it in the UI (Containers → registries)"
    fi
  done
  return 0
}

step_terraform() {
  terraform -chdir="$INFRA_DIR" init -input=false > /dev/null
  local out rc=0 trc=0 env
  local -a targets=()
  local had_quota="${GOOGLE_CLOUD_QUOTA_PROJECT+1}" prev_quota="${GOOGLE_CLOUD_QUOTA_PROJECT-}"
  out="$(mktemp)"
  if gcp_export_quota_project; then
    # The org policies need a demo project as quota project, so delete them (and their dependents) while it
    # still exists; the full destroy below runs without it, as the demo projects go away during it.
    for env in $(gcp_envs); do
      targets+=("-target=module.gcp[\"$env\"].google_org_policy_policy.allowed_member_domains"
        "-target=module.gcp[\"$env\"].google_org_policy_policy.sa_key_creation"
        "-target=module.gcp[\"$env\"].google_org_policy_policy.uniform_bucket_access")
    done
    terraform -chdir="$INFRA_DIR" destroy -auto-approve -input=false "${targets[@]}" 2>&1 | tee "$out" || trc="${PIPESTATUS[0]}"
    ((trc == 0)) || log_warn "deleting the GCP org policies failed (rc $trc); running the full destroy anyway"
    if [[ -n "$had_quota" ]]; then export GOOGLE_CLOUD_QUOTA_PROJECT="$prev_quota"; else unset GOOGLE_CLOUD_QUOTA_PROJECT; fi
  fi
  terraform -chdir="$INFRA_DIR" destroy -auto-approve -input=false 2>&1 | tee -a "$out" || rc="${PIPESTATUS[0]}"
  ((rc != 0)) || rc="$trc"
  if ((rc != 0)) && grep -qiE 'default credentials|invalid_grant|reauth|oauth2' "$out"; then
    log_warn "Google authentication failed; run: gcloud auth application-default login, then rerun destroy.sh"
  fi
  rm -f "$out"
  return "$rc"
}

step_cleanup() {
  rm -f "$STATE_DIR/aikido.json" "$STATE_DIR/kubeconfig"
}

# Tagged resources that really still exist (the tagging API lags behind deletions).
_tagged_resources() {
  local arns arn
  arns="$(aws resourcegroupstaggingapi get-resources --region "$REGION" \
    --tag-filters Key=Project,Values=aikido-demo --query 'ResourceTagMappingList[].ResourceARN' --output text)" || return 1
  for arn in $arns; do
    aws_resource_exists "$arn" && printf '%s\n' "$arn"
  done
  return 0
}

step_leftovers() {
  local tagged="" clouds="" gcp="" i ok=1
  for ((i = 0; i < 12; i++)); do
    tagged="$(_tagged_resources)" || return 1
    [[ -z "$tagged" ]] && break
    sleep 10
  done
  if aikido_token > /dev/null; then
    clouds="$(_aikido_paged /clouds | jq -r 'select(.name | startswith("aikido-demo-")) | "\(.id) \(.name)"')" || clouds="(could not list Aikido clouds)"
  else
    clouds="(could not list Aikido clouds)"
  fi
  if ! command -v gcloud > /dev/null 2>&1; then
    log_info "gcloud not installed; skipping the GCP project listing"
  elif gcp="$(gcloud projects list --filter='name~^aikido-demo-(dev|prod)- AND lifecycleState=ACTIVE' --format='value(projectId)' 2> /dev/null)"; then
    :
  else
    gcp=""
    log_warn "(could not list GCP projects)"
  fi
  if [[ -n "$tagged" ]]; then
    ok=0
    log_warn "tagged AWS resources left:"
    tr -s '[:space:]' '\n' <<< "$tagged" | sed 's/^/      /' >&2
  fi
  if [[ -n "$clouds" ]]; then
    ok=0
    log_warn "Aikido clouds left: $clouds"
  fi
  if [[ -n "$gcp" ]]; then
    ok=0
    log_warn "GCP projects left (ACTIVE):"
    tr -s '[:space:]' '\n' <<< "$gcp" | sed 's/^/      /' >&2
  fi
  if ((ok)); then
    log_info "leftovers: none"
    return 0
  fi
  return 1
}

main() {
  parse_args "$@"
  SECONDS=0
  log_step "Preflight"
  step_preflight
  set_external_id

  log_step "Kubeconfig"
  if step_kubeconfig; then
    CLUSTER_PRESENT=1
  else
    log_info "cluster absent; skipping the Helm steps"
  fi
  if ((CLUSTER_PRESENT)); then
    run_step "Uninstall chatbot-server and wait for its load balancer" step_chatbot
    run_step "Uninstall the Aikido agent" step_agent
  fi
  run_step "Delete Aikido demo clouds" step_aikido_clouds
  run_step "Report Aikido registries that need manual removal" step_gcp_registries
  run_step "Terraform destroy" step_terraform
  # Keep the state (cloud ids) if anything failed, so a rerun can still find them.
  if [[ ${#ERRORS[@]} -eq 0 ]]; then
    run_step "Clean up .state" step_cleanup
  fi
  run_step "Leftover report" step_leftovers

  local elapsed=$SECONDS
  if [[ ${#ERRORS[@]} -gt 0 ]]; then
    log_warn "destroy finished with failures after $((elapsed / 60))m$((elapsed % 60))s: ${ERRORS[*]}"
    exit 1
  fi
  log_step "Destroy complete ($((elapsed / 60))m$((elapsed % 60))s)"
}

# Sourcing (bats) only defines the functions.
if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
