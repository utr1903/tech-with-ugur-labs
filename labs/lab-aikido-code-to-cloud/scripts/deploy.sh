#!/usr/bin/env bash
# One-command deploy of the Aikido demo: AWS + GCP dev/prod (Terraform), images, data, Aikido clouds, Helm releases.
# Idempotent: re-running converges without duplicate clouds or releases.
set -euo pipefail

# shellcheck source-path=SCRIPTDIR source=lib/aikido.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/aikido.sh"

AWS_CLOUD_NAME="aikido-demo-aws"
K8S_CLOUD_NAME="aikido-demo-eks"
GCP_CLOUD_PREFIX="aikido-demo-gcp-"
GCP_REGISTRY_HOST="europe-west3-docker.pkg.dev"
# Tunable so bats doesn't sleep; defaults are 10 min for health and 5 min for container discovery.
GCP_HEALTH_TRIES="${GCP_HEALTH_TRIES:-40}" GCP_HEALTH_DELAY="${GCP_HEALTH_DELAY:-15}"
GCP_CONTAINER_POLL_TRIES="${GCP_CONTAINER_POLL_TRIES:-20}" GCP_CONTAINER_POLL_DELAY="${GCP_CONTAINER_POLL_DELAY:-15}"
SKIP_INFRA=0 SKIP_IMAGE=0 SKIP_SEED=0

usage() {
  cat << 'EOF'
Usage: scripts/deploy.sh (or: make deploy) [--yes] [--skip-infra] [--skip-image] [--skip-seed]

Deploys the deliberately vulnerable Aikido demo and registers it with Aikido.

  --yes         don't ask for confirmation
  --skip-infra  skip terraform apply (use the existing outputs)
  --skip-image  skip the image builds; reuse the newest tag in ECR (GCP VMs keep :latest)
  --skip-seed   skip seeding fake data into S3 and the GCP buckets
  --help        show this help
EOF
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --yes) export ASSUME_YES=1 ;;
      --skip-infra) SKIP_INFRA=1 ;;
      --skip-image) SKIP_IMAGE=1 ;;
      --skip-seed) SKIP_SEED=1 ;;
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

step_preflight() {
  log_step "Preflight"
  require_tools
  load_env
  require_env AIKIDO_CLIENT_ID AIKIDO_CLIENT_SECRET AIKIDO_REPO_NAME
  require_tfvars
  aws_preflight
  gcp_preflight
  cat >&2 << EOF
    This will create or update (≈ \$0.25/h while up):
      - AWS: VPC, EKS cluster ($( ((SKIP_INFRA)) && echo skipped || echo terraform apply)), S3 bucket, ECR, IAM roles
      - GCP projects aikido-demo-dev-* and aikido-demo-prod-* (VM, bucket, Artifact Registry, Aikido service accounts)
      - image build/push: $( ((SKIP_IMAGE)) && echo skipped || echo yes), data seed: $( ((SKIP_SEED)) && echo skipped || echo yes)
      - Aikido clouds $AWS_CLOUD_NAME, $K8S_CLOUD_NAME, ${GCP_CLOUD_PREFIX}dev and ${GCP_CLOUD_PREFIX}prod, GCP registries,
        Helm releases aikido and chatbot-server
EOF
  confirm "Deploy the Aikido demo?"
}

step_external_id() {
  log_step "Aikido external ID"
  aikido_token > /dev/null || die "cannot get an Aikido API token"
  local ws
  if [[ -n "${AIKIDO_EXTERNAL_ID:-}" ]]; then
    TF_VAR_aikido_external_id="$AIKIDO_EXTERNAL_ID"
    log_info "using AIKIDO_EXTERNAL_ID override: $TF_VAR_aikido_external_id"
  else
    ws="$(aikido_workspace_id)" || die "cannot read the Aikido workspace"
    TF_VAR_aikido_external_id="aikido-$ws"
    log_info "derived from workspace $ws: $TF_VAR_aikido_external_id"
  fi
  export TF_VAR_aikido_external_id
}

step_terraform() {
  if ((SKIP_INFRA)); then
    log_step "Terraform (skipped)"
  else
    log_step "Terraform apply (≈ 10 min on a fresh account)"
    terraform -chdir="$INFRA_DIR" init -input=false > /dev/null
    if ! gcp_export_quota_project; then
      # Fresh deploy: projects and APIs don't need a quota project; the org policies do (the dev project).
      log_info "no GCP projects yet: creating the projects and their APIs first"
      # Refresh first so the targeted apply below works from the current state.
      terraform -chdir="$INFRA_DIR" apply -refresh-only -auto-approve -input=false
      terraform -chdir="$INFRA_DIR" apply -auto-approve -input=false \
        -target='module.gcp["dev"].google_project_service.this' -target='module.gcp["prod"].google_project_service.this'
      gcp_export_quota_project || die "the dev GCP project is not in terraform state after the targeted apply"
    fi
    terraform -chdir="$INFRA_DIR" apply -auto-approve -input=false
  fi
  REGION="$(tf_output region)"
  CLUSTER="$(tf_output cluster_name)"
  BUCKET="$(tf_output data_bucket_name)"
  ECR_URL="$(tf_output ecr_repository_url)"
  AIKIDO_ROLE_ARN="$(tf_output aikido_role_arn)"
  GCP_JSON="$(tf_output_json gcp)"
  log_info "cluster $CLUSTER, bucket $BUCKET, ECR $ECR_URL"
  log_info "GCP projects: $(jq -r '[.[].project_id] | join(", ")' <<< "$GCP_JSON")"
}

step_kubeconfig() {
  log_step "Kubeconfig ($STATE_DIR/kubeconfig)"
  mkdir -p "$STATE_DIR"
  export KUBECONFIG="$STATE_DIR/kubeconfig"
  aws eks update-kubeconfig --name "$CLUSTER" --region "$REGION" --kubeconfig "$KUBECONFIG" > /dev/null
  kubectl wait --for=condition=Ready nodes --all --timeout=5m
}

step_image() {
  local repo_name="${ECR_URL#*/}"
  if ((SKIP_IMAGE)); then
    log_step "Image build (skipped)"
    IMAGE_TAG="$(aws ecr describe-images --region "$REGION" --repository-name "$repo_name" \
      --query 'sort_by(imageDetails,&imagePushedAt)[-1].imageTags[0]' --output text 2> /dev/null || true)"
    [[ -n "$IMAGE_TAG" && "$IMAGE_TAG" != "None" ]] || die "--skip-image given but ECR has no image yet"
    log_info "reusing $ECR_URL:$IMAGE_TAG"
    return 0
  fi
  IMAGE_TAG="$(git -C "$LAB_DIR" rev-parse --short HEAD)"
  git -C "$LAB_DIR" diff --quiet HEAD || IMAGE_TAG="$IMAGE_TAG-dirty"
  log_step "Image build and push ($ECR_URL:$IMAGE_TAG)"
  aws ecr get-login-password --region "$REGION" | docker login --username AWS --password-stdin "${ECR_URL%%/*}" > /dev/null
  docker buildx build --platform linux/amd64 --push -t "$ECR_URL:$IMAGE_TAG" "$SERVER_DIR"
}

step_seed() {
  if ((SKIP_SEED)); then
    log_step "Seed (skipped)"
    return 0
  fi
  log_step "Seed fake data into s3://$BUCKET"
  [[ -d "$SERVER_DIR/node_modules" ]] || (cd "$SERVER_DIR" && npm ci)
  (cd "$SERVER_DIR" && npm run --silent seed -- --bucket "$BUCKET" --region "$REGION")
}

# _gcp ENV FIELD: a field of the terraform `gcp` output (project_id, vm_ip, bucket, registry).
_gcp() { jq -er --arg e "$1" --arg f "$2" '.[$e][$f]' <<< "$GCP_JSON"; }

step_gcp_image() {
  if ((SKIP_IMAGE)); then
    log_step "GCP image build (skipped; VMs keep pulling files-app:latest)"
    return 0
  fi
  local env registry tags=()
  for env in $(gcp_envs); do
    registry="$(_gcp "$env" registry)"
    tags+=(-t "$registry/files-app:$IMAGE_TAG" -t "$registry/files-app:latest")
  done
  log_step "GCP image build and push (files-app:$IMAGE_TAG and :latest, dev and prod)"
  gcloud auth configure-docker "$GCP_REGISTRY_HOST" --quiet > /dev/null 2>&1 ||
    die "gcloud auth configure-docker $GCP_REGISTRY_HOST failed"
  docker buildx build --platform linux/amd64 --push "${tags[@]}" "$GCP_APP_DIR"
}

step_gcp_seed() {
  if ((SKIP_SEED)); then
    log_step "GCP seed (skipped)"
    return 0
  fi
  [[ -d "$SERVER_DIR/node_modules" ]] || (cd "$SERVER_DIR" && npm ci)
  local env bucket seed dir
  for env in $(gcp_envs); do
    bucket="$(_gcp "$env" bucket)"
    case "$env" in prod) seed=4242 ;; *) seed=42 ;; esac
    dir="$GCP_TMP/$env"
    log_step "Seed fake data into gs://$bucket ($env, seed $seed)"
    rm -rf "$dir"
    (cd "$SERVER_DIR" && npm run --silent export -- --out "$dir" --seed "$seed") > /dev/null
    gcloud storage cp -r "$dir"/* "gs://$bucket/private/" > /dev/null
    printf 'Aikido demo file share (%s).\nPublic documents live here; try /files?name=welcome.txt.\n' "$env" > "$GCP_TMP/$env-readme.txt"
    printf 'Welcome to the %s file share of the Aikido demo.\nEverything in this project is fake data.\n' "$env" > "$GCP_TMP/$env-welcome.txt"
    gcloud storage cp "$GCP_TMP/$env-readme.txt" "gs://$bucket/public/readme.txt" > /dev/null
    gcloud storage cp "$GCP_TMP/$env-welcome.txt" "gs://$bucket/public/welcome.txt" > /dev/null
  done
}

_gcp_healthz() { curl -fsS -o /dev/null --max-time 5 "http://$1:8080/healthz"; }

step_gcp_health() {
  log_step "Wait for the GCP file apps (/healthz)"
  local env ip
  for env in $(gcp_envs); do
    ip="$(_gcp "$env" vm_ip)"
    if retry "$GCP_HEALTH_TRIES" "$GCP_HEALTH_DELAY" _gcp_healthz "$ip" 2> /dev/null; then
      log_info "$env: http://$ip:8080 is up"
    else
      log_warn "$env: http://$ip:8080/healthz did not answer in time (VM still booting or pulling the image?); continuing"
    fi
  done
}

# _gcp_decode_key ENV KIND OUT: writes the decoded SA key (cspm|registry) to OUT (mode 600). Never prints it.
_gcp_decode_key() {
  (
    umask 077
    mkdir -p "$(dirname "$3")"
    # base64 -d (not jq's @base64d, which rejects padded input in jq 1.8) works with GNU and macOS base64.
    tf_output_json gcp_aikido_keys | jq -er --arg e "$1" --arg k "$2" '.[$e][$k]' | base64 -d > "$3"
  )
}

# _gcp_mark_containers ENV REGISTRY_ID: best effort; waits for Aikido to discover the images, then marks them.
_gcp_mark_containers() {
  local env="$1" registry_id="$2" ids="" i id
  for ((i = 1; i <= GCP_CONTAINER_POLL_TRIES; i++)); do
    ids="$(aikido_containers_in_registry "$registry_id" 2> /dev/null || true)"
    [[ -n "$ids" ]] && break
    [[ $i -lt $GCP_CONTAINER_POLL_TRIES ]] && sleep "$GCP_CONTAINER_POLL_DELAY"
  done
  if [[ -z "$ids" ]]; then
    log_warn "$env: Aikido lists no containers in registry $registry_id yet; mark them in the UI later"
    return 0
  fi
  for id in $ids; do
    if aikido_mark_container "$id" 2> /dev/null; then
      log_info "$env: container $id activated, internet-exposed, extreme sensitivity, scan triggered"
    else
      log_warn "$env: could not fully mark container $id; continuing"
    fi
  done
}

step_aikido_gcp() {
  local env name project aikido_env cspm_key registry_key cloud_id registry_id
  for env in $(gcp_envs); do
    name="$GCP_CLOUD_PREFIX$env"
    project="$(_gcp "$env" project_id)"
    aikido_env="$(gcp_aikido_env "$env")"
    log_step "Aikido GCP cloud ($name, $aikido_env) and registry (project $project)"
    cspm_key="$GCP_TMP/keys/$env-cspm.json"
    registry_key="$GCP_TMP/keys/$env-registry.json"
    _gcp_decode_key "$env" cspm "$cspm_key" || die "cannot read the $env CSPM key from terraform"
    _gcp_decode_key "$env" registry "$registry_key" || die "cannot read the $env registry key from terraform"

    cloud_id="$(_existing_cloud_id "$(state_get "gcp_${env}_cloud_id")" "$name")" || die "cannot list Aikido clouds"
    if [[ -n "$cloud_id" ]]; then
      log_info "already connected: cloud $cloud_id"
    else
      cloud_id="$(aikido_connect_gcp "$name" "$project" "$cspm_key" "$aikido_env")" ||
        die "GCP connect failed for project $project"
      log_info "connected: cloud $cloud_id"
    fi
    state_set "gcp_${env}_cloud_id" "$cloud_id"

    registry_id="$(state_get "gcp_${env}_registry_id")"
    if aikido_registry_exists "$registry_id"; then
      log_info "registry already added: $registry_id"
    else
      registry_id="$(aikido_add_gcp_registry "$project" "$registry_key")" ||
        die "adding the Artifact Registry of $project to Aikido failed"
      log_info "registry added: $registry_id"
    fi
    state_set "gcp_${env}_registry_id" "$registry_id"
    rm -f "$cspm_key" "$registry_key"

    _gcp_mark_containers "$env" "$registry_id"
  done
}

# Prints the id if it still exists in Aikido, else looks the cloud up by name.
_existing_cloud_id() {
  local state_id="$1" name="$2" found
  found="$(aikido_find_cloud_by_name "$name")" || return 1
  if [[ -n "$state_id" && "$found" != "$state_id" ]]; then
    log_info "state id $state_id for $name is stale"
  fi
  printf '%s' "$found"
}

step_aikido_aws() {
  log_step "Aikido AWS cloud ($AWS_CLOUD_NAME)"
  AWS_CLOUD_ID="$(_existing_cloud_id "$(state_get aws_cloud_id)" "$AWS_CLOUD_NAME")" || die "cannot list Aikido clouds"
  if [[ -n "$AWS_CLOUD_ID" ]]; then
    log_info "already connected: cloud $AWS_CLOUD_ID"
  else
    AWS_CLOUD_ID="$(aikido_connect_aws "$AIKIDO_ROLE_ARN" "$AWS_CLOUD_NAME")" ||
      die "AWS connect failed; if the role can't be assumed, the external ID ($TF_VAR_aikido_external_id) is probably wrong"
    log_info "connected: cloud $AWS_CLOUD_ID"
  fi
  state_set aws_cloud_id "$AWS_CLOUD_ID"
}

step_aikido_k8s() {
  log_step "Aikido K8s cloud ($K8S_CLOUD_NAME) and agent"
  local existing installed action created token
  existing="$(_existing_cloud_id "$(state_get k8s_cloud_id)" "$K8S_CLOUD_NAME")" || die "cannot list Aikido clouds"
  if helm_release_deployed aikido aikido; then installed=yes; else installed=no; fi
  action="$(decide_k8s_cloud "$existing" "$installed")"
  log_info "cloud '${existing:-none}', agent release installed: $installed -> $action"
  case "$action" in
    reuse)
      K8S_CLOUD_ID="$existing"
      state_set k8s_cloud_id "$K8S_CLOUD_ID"
      # The one-time agent token can't be fetched again, so keep the release's
      # own --set values but take chart values (e.g. runtimeDetection) fresh.
      helm dependency build "$AIKIDO_CHART_DIR" > /dev/null 2>&1 || helm dependency update "$AIKIDO_CHART_DIR" > /dev/null
      helm upgrade aikido "$AIKIDO_CHART_DIR" -n aikido --reset-then-reuse-values \
        --wait --timeout 5m > /dev/null
      log_info "agent release 'aikido' upgraded with current chart values"
      return 0
      ;;
    replace)
      aikido_delete_cloud "$existing" || die "cannot delete stale K8s cloud $existing"
      ;;
  esac
  created="$(aikido_create_k8s "$K8S_CLOUD_NAME")" || die "cannot create the Aikido K8s cloud"
  K8S_CLOUD_ID="$(jq -r '.id' <<< "$created")"
  token="$(jq -r '.agent_token' <<< "$created")"
  unset created
  state_set k8s_cloud_id "$K8S_CLOUD_ID"
  log_info "created: cloud $K8S_CLOUD_ID"

  helm dependency build "$AIKIDO_CHART_DIR" > /dev/null 2>&1 || helm dependency update "$AIKIDO_CHART_DIR" > /dev/null
  helm upgrade -i aikido "$AIKIDO_CHART_DIR" -n aikido --create-namespace \
    --set "kubernetes-agent.config.apiToken=$token" --wait --timeout 5m > /dev/null
  unset token
  log_info "agent release 'aikido' installed"
}

step_chatbot() {
  log_step "Chatbot release (chatbot-server, image tag $IMAGE_TAG)"
  helm upgrade -i chatbot-server "$SERVER_CHART_DIR" -n chatbot --create-namespace \
    --set "image.repository=$ECR_URL" --set "image.tag=$IMAGE_TAG" \
    --set "dataBucket=$BUCKET" --set "awsRegion=$REGION" --wait --timeout 5m > /dev/null
}

_lb_hostname() {
  kubectl -n chatbot get svc chatbot-server -o jsonpath='{.status.loadBalancer.ingress[0].hostname}' 2> /dev/null
}

_healthz() { curl -fsS -o /dev/null --max-time 5 "http://$LB_HOST/healthz"; }

step_expose() {
  log_step "Wait for the public load balancer"
  local i
  LB_HOST=""
  for ((i = 0; i < 30; i++)); do
    LB_HOST="$(_lb_hostname || true)"
    [[ -n "$LB_HOST" ]] && break
    sleep 10
  done
  [[ -n "$LB_HOST" ]] || die "the chatbot-server Service got no load balancer hostname within 5 minutes"
  log_info "hostname $LB_HOST, waiting for DNS and /healthz"
  retry 30 10 _healthz || die "http://$LB_HOST/healthz did not answer within 5 minutes"
}

step_repo_scan() {
  log_step "Aikido repo scan (best effort)"
  local repo
  if repo="$(aikido_find_code_repo "$AIKIDO_REPO_NAME")" && [[ -n "$repo" ]] && aikido_scan_repo "$repo"; then
    log_info "scan triggered for repo $repo"
  else
    log_warn "could not trigger the repo scan; continuing"
  fi
}

step_summary() {
  state_set_once deployed_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  local elapsed=$SECONDS
  cat << EOF

Aikido demo is up ($((elapsed / 60))m$((elapsed % 60))s).
  Chatbot:        http://$LB_HOST  (login: alice / alice123)
  Aikido clouds:  $AWS_CLOUD_NAME=$AWS_CLOUD_ID, $K8S_CLOUD_NAME=$K8S_CLOUD_ID
$(_gcp_summary)
  kubectl:        export KUBECONFIG=$STATE_DIR/kubeconfig
  Tear down:      make destroy            (costs ≈ \$0.25/h while up)
URL: http://$LB_HOST
EOF
}

_gcp_summary() {
  local env ip project
  for env in $(gcp_envs); do
    ip="$(_gcp "$env" vm_ip)"
    project="$(_gcp "$env" project_id)"
    cat << EOF
  GCP $env:        http://$ip:8080  (Aikido cloud $GCP_CLOUD_PREFIX$env=$(state_get "gcp_${env}_cloud_id"))
    VM scanning:  Aikido UI: Virtual Machines → Connect VMs → Google Cloud → project $project
EOF
  done
}

main() {
  parse_args "$@"
  SECONDS=0
  # Decoded SA keys and the exported GCP dataset live here; removed on any exit.
  GCP_TMP="$(umask 077 && mktemp -d)"
  trap 'rm -rf "$GCP_TMP"' EXIT
  step_preflight
  step_external_id
  step_terraform
  step_kubeconfig
  step_image
  step_gcp_image
  step_seed
  step_gcp_seed
  aikido_token > /dev/null || die "cannot refresh the Aikido API token"
  step_aikido_aws
  step_aikido_k8s
  step_aikido_gcp
  step_chatbot
  step_expose
  step_gcp_health
  step_repo_scan
  step_summary
}

# Sourcing (bats) only defines the functions.
if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
