# shellcheck shell=bash
# Shared helpers for deploy.sh and destroy.sh. Source it; don't execute it.

# --- Paths (resolved from this file, so scripts work from any cwd) ----------
_COMMON_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LAB_DIR="$(cd "$_COMMON_LIB_DIR/../.." && pwd)"
INFRA_DIR="$LAB_DIR/infra"
SERVER_DIR="$LAB_DIR/apps/server"
SERVER_CHART_DIR="$SERVER_DIR/helm"
AIKIDO_CHART_DIR="$LAB_DIR/apps/aikido-k8s/helm"
GCP_APP_DIR="$LAB_DIR/apps/gcp-files"
# Overridable only through LAB_-prefixed names, so a stray STATE_DIR/ENV_FILE in the shell is ignored.
STATE_DIR="${LAB_STATE_DIR:-$LAB_DIR/.state}"
ENV_FILE="${LAB_ENV_FILE:-$LAB_DIR/.env}"
export LAB_DIR INFRA_DIR SERVER_DIR SERVER_CHART_DIR AIKIDO_CHART_DIR GCP_APP_DIR STATE_DIR

# --- Logging (stderr, so stdout stays clean for return values) -------------
if [[ -t 2 ]]; then
  _C_STEP=$'\033[1;36m' _C_WARN=$'\033[1;33m' _C_ERR=$'\033[1;31m' _C_OFF=$'\033[0m'
else
  _C_STEP="" _C_WARN="" _C_ERR="" _C_OFF=""
fi

log_step() { printf '%s==> %s%s\n' "$_C_STEP" "$*" "$_C_OFF" >&2; }
log_info() { printf '    %s\n' "$*" >&2; }
log_warn() { printf '%s[warn] %s%s\n' "$_C_WARN" "$*" "$_C_OFF" >&2; }
die() {
  printf '%s[error] %s%s\n' "$_C_ERR" "$*" "$_C_OFF" >&2
  exit 1
}

# --- Preflight --------------------------------------------------------------
require_tools() {
  local missing=() t
  for t in aws gcloud terraform helm kubectl docker node npm jq curl; do
    command -v "$t" > /dev/null 2>&1 && continue
    # OPTIONAL_TOOLS (space-separated): a missing tool only warns.
    if [[ " ${OPTIONAL_TOOLS:-} " == *" $t "* ]]; then
      log_warn "optional tool missing: $t (some steps will be skipped)"
    else
      missing+=("$t")
    fi
  done
  if [[ ${#missing[@]} -gt 0 ]]; then
    for t in "${missing[@]}"; do log_warn "missing tool: $t (macOS: brew install $t)"; done
    die "install the missing tools and retry"
  fi
  docker buildx version > /dev/null 2>&1 || die "docker buildx is not available (install Docker Desktop or the buildx plugin)"
}

# Loads $ENV_FILE. Variables already set in the environment win over the file.
load_env() {
  [[ -f "$ENV_FILE" ]] || die "missing $ENV_FILE (cp .env.example .env in the lab folder and fill it in)"
  local saved=() k kv
  while IFS= read -r k || [[ -n "$k" ]]; do
    if [[ -n "${!k+x}" ]]; then saved+=("$k=${!k}"); fi
  done < <(sed -n 's/^[[:space:]]*\(export[[:space:]]\{1,\}\)\{0,1\}\([A-Za-z_][A-Za-z0-9_]*\)=.*/\2/p' "$ENV_FILE")
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
  for kv in "${saved[@]+"${saved[@]}"}"; do
    export "${kv%%=*}=${kv#*=}"
  done
}

# Terraform runs with -input=false, so missing reader values would only fail deep into the apply.
require_tfvars() {
  [[ -f "$INFRA_DIR/terraform.tfvars" ]] ||
    die "missing $INFRA_DIR/terraform.tfvars (cp infra/terraform.tfvars.example infra/terraform.tfvars and fill in your GCP organization, billing account and customer id)"
}

require_env() {
  local missing=() v
  for v in "$@"; do
    [[ -n "${!v:-}" ]] || missing+=("$v")
  done
  [[ ${#missing[@]} -eq 0 ]] || die "missing environment variables: ${missing[*]} (set them in $ENV_FILE)"
}

aws_preflight() {
  local account region
  account="$(aws sts get-caller-identity --query Account --output text)" || die "AWS CLI is not logged in"
  region="${AWS_REGION:-${AWS_DEFAULT_REGION:-$(aws configure get region 2> /dev/null || true)}}"
  region="${region:-eu-central-1}"
  log_info "AWS account $account, region $region"
  if [[ "$region" != "eu-central-1" && "${ALLOW_ANY_REGION:-0}" != "1" ]]; then
    die "region is $region, expected eu-central-1 (set ALLOW_ANY_REGION=1 to override)"
  fi
}

GCP_ORG_POLICY_ROLE="roles/orgpolicy.policyAdmin"

# tfvars_value NAME: a quoted string value from infra/terraform.tfvars; empty when it is not set.
tfvars_value() {
  sed -n "s/^[[:space:]]*$1[[:space:]]*=[[:space:]]*\"\([^\"]*\)\".*/\1/p" "$INFRA_DIR/terraform.tfvars" 2> /dev/null | head -n 1
}

# gcp_preflight: ADC works and the gcloud account may override org policies on the lab projects
# in the organization named by gcp_org_id in infra/terraform.tfvars.
gcp_preflight() {
  command -v gcloud > /dev/null 2>&1 || die "missing tool: gcloud (macOS: brew install --cask google-cloud-sdk)"
  gcloud auth application-default print-access-token > /dev/null 2>&1 ||
    die "no GCP application-default credentials; run: gcloud auth application-default login"
  local account roles GCP_ORG_ID
  GCP_ORG_ID="$(tfvars_value gcp_org_id)"
  [[ -n "$GCP_ORG_ID" ]] || die "gcp_org_id is not set in $INFRA_DIR/terraform.tfvars (see infra/terraform.tfvars.example)"
  account="$(gcloud config get-value account 2> /dev/null)"
  [[ -n "$account" ]] || die "gcloud has no active account; run: gcloud auth login"
  roles="$(gcloud organizations get-iam-policy "$GCP_ORG_ID" --flatten=bindings[].members \
    --filter="bindings.role=$GCP_ORG_POLICY_ROLE AND bindings.members=user:$account" \
    --format='value(bindings.role)' 2> /dev/null)" || die "cannot read the IAM policy of org $GCP_ORG_ID"
  [[ "$roles" == *"$GCP_ORG_POLICY_ROLE"* ]] ||
    die "user:$account lacks $GCP_ORG_POLICY_ROLE on org $GCP_ORG_ID; ask an org admin to run:
    gcloud organizations add-iam-policy-binding $GCP_ORG_ID --member=user:$account --role=$GCP_ORG_POLICY_ROLE"
  log_info "GCP account $account ($GCP_ORG_POLICY_ROLE on org $GCP_ORG_ID)"
}

gcp_envs() { echo "dev prod"; }

# gcp_aikido_env ENV: the Aikido environment a GCP env is connected as.
gcp_aikido_env() {
  case "$1" in
    dev) echo development ;;
    prod) echo production ;;
    *) die "unknown GCP env: $1" ;;
  esac
}

# gcp_project_from_state ENV: that env's demo project id from terraform state; empty when it doesn't exist.
gcp_project_from_state() {
  local id
  id="$(terraform -chdir="$INFRA_DIR" state show -no-color "module.gcp[\"$1\"].google_project.this" 2> /dev/null |
    awk -F'"' '$1 ~ /^[[:space:]]*project_id[[:space:]]*=/ { print $2; exit }')"
  [[ "$id" =~ ^aikido-demo-(dev|prod)-[0-9a-f]+$ ]] || return 1
  echo "$id"
}

# ADC user credentials have no quota project, and the orgpolicy API rejects them without one.
# Bill Google API quota to a demo project in state (dev, else prod; never a real project). Fails if none is.
gcp_export_quota_project() {
  local env project
  for env in $(gcp_envs); do
    project="$(gcp_project_from_state "$env")"
    if [[ -n "$project" ]]; then
      export GOOGLE_CLOUD_QUOTA_PROJECT="$project"
      log_info "Google API quota project: $project ($env demo project)"
      return 0
    fi
  done
  return 1
}

# --- Small utilities ----------------------------------------------------------
tf_output() { terraform -chdir="$INFRA_DIR" output -raw "$1"; }
tf_output_json() { terraform -chdir="$INFRA_DIR" output -json "$1"; }

# retry N DELAY cmd...: runs cmd up to N times, DELAY seconds apart.
retry() {
  local n="$1" delay="$2" i rc=0
  shift 2
  for ((i = 1; i <= n; i++)); do
    "$@" && return 0
    rc=$?
    [[ $i -lt $n ]] && sleep "$delay"
  done
  return "$rc"
}

# confirm MSG: yes with ASSUME_YES=1, otherwise asks on a TTY.
confirm() {
  [[ "${ASSUME_YES:-0}" == "1" ]] && return 0
  [[ -t 0 ]] || die "no TTY for the confirmation prompt; pass --yes"
  local answer
  read -r -p "$1 [y/N] " answer
  [[ "$answer" == "y" || "$answer" == "Y" ]] || die "aborted"
}

# --- State (.state/aikido.json) -----------------------------------------
_state_file() { printf '%s/aikido.json' "$STATE_DIR"; }

state_get() {
  local f
  f="$(_state_file)"
  [[ -f "$f" ]] || return 0
  jq -r --arg k "$1" '.[$k] // empty' "$f"
}

state_set() {
  local f tmp
  f="$(_state_file)"
  mkdir -p "$STATE_DIR"
  [[ -f "$f" ]] || echo '{}' > "$f"
  tmp="$(mktemp "$STATE_DIR/.aikido.json.XXXXXX")"
  jq --arg k "$1" --arg v "$2" '.[$k] = $v' "$f" > "$tmp" && mv "$tmp" "$f"
}

# state_set_once KEY VALUE: like state_set, but keeps an existing value (e.g. the first deploy time).
state_set_once() {
  [[ -n "$(state_get "$1")" ]] || state_set "$1" "$2"
}

# minutes_since ISO8601_UTC: whole minutes between the timestamp and now.
minutes_since() {
  jq -n --arg t "$1" '((now - ($t | fromdateiso8601)) / 60) | floor'
}

# aws_resource_exists ARN: the tagging API keeps listing deleted EC2 resources for a while,
# so EC2 ARNs are double-checked with a describe call. Other types are assumed to exist.
aws_resource_exists() {
  local arn="$1" service region rest type id cmd flag err
  IFS=: read -r _ _ service region _ rest <<< "$arn"
  [[ "$service" == "ec2" ]] || return 0
  type="${rest%%/*}"
  id="${rest#*/}"
  case "$type" in
    security-group) cmd=describe-security-groups flag=--group-ids ;;
    subnet) cmd=describe-subnets flag=--subnet-ids ;;
    vpc) cmd=describe-vpcs flag=--vpc-ids ;;
    internet-gateway) cmd=describe-internet-gateways flag=--internet-gateway-ids ;;
    route-table) cmd=describe-route-tables flag=--route-table-ids ;;
    network-interface) cmd=describe-network-interfaces flag=--network-interface-ids ;;
    *) return 0 ;;
  esac
  if err="$(aws ec2 "$cmd" --region "$region" "$flag" "$id" 2>&1 > /dev/null)"; then
    return 0
  fi
  [[ "$err" != *NotFound* ]]
}

# helm_release_deployed RELEASE NAMESPACE: true only for a release in status "deployed"
# (a failed or pending release must be reinstalled).
helm_release_deployed() {
  helm status "$1" -n "$2" -o json 2> /dev/null | jq -e '.info.status == "deployed"' > /dev/null
}
