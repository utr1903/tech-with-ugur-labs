#!/usr/bin/env bash
# Shared constants and helpers for the lab scripts. Source, don't execute.

export GITEA_USER="labowner"
export GITEA_HOST="http://localhost:3000"
export CLUSTER="flux-lab"
export APP_URL="http://localhost:8080"
LAB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export LAB_DIR

# Derives GITEA_PASSWORD and FLEET_PUSH_URL from tmp/gitea-password. Runs once
# at source time (empty password if the file doesn't exist yet) and again
# from up.sh right after it generates the file, so both cases end up with the
# real value in scope.
gitea_load_password() {
  if [[ -f "${LAB_DIR}/tmp/gitea-password" ]]; then
    GITEA_PASSWORD="$(cat "${LAB_DIR}/tmp/gitea-password")"
  else
    GITEA_PASSWORD=""
  fi
  export GITEA_PASSWORD
  export FLEET_PUSH_URL="http://${GITEA_USER}:${GITEA_PASSWORD}@localhost:3000/${GITEA_USER}/fleet.git"
}
gitea_load_password

fleet_fresh_clone() {
  rm -rf "${LAB_DIR}/tmp/fleet-work"
  git clone --quiet "${FLEET_PUSH_URL}" "${LAB_DIR}/tmp/fleet-work"
}

fleet_push() {
  local message="$1"
  git -C "${LAB_DIR}/tmp/fleet-work" add -A
  git -C "${LAB_DIR}/tmp/fleet-work" commit --quiet -m "${message}"
  git -C "${LAB_DIR}/tmp/fleet-work" push --quiet
  flux reconcile source git flux-system -n flux-system >/dev/null
}

set_release() {
  local tag="$1" app_version="$2" migrate_to="$3"
  yq -i "
    .spec.values.image.tag = \"${tag}\" |
    .spec.values.appVersion = \"${app_version}\" |
    .spec.values.migrateTo = \"${migrate_to}\"
  " "${LAB_DIR}/tmp/fleet-work/apps/helmrelease.yaml"
}

app_get_messages() {
  curl -fsS -H "Authorization: Bearer $(cat "${LAB_DIR}/tmp/api-token")" "${APP_URL}/api/messages"
}

wait_for() {
  local timeout="$1" description="$2"
  shift 2
  local waited=0
  until "$@" >/dev/null 2>&1; do
    if (( waited >= timeout )); then
      echo "TIMEOUT after ${timeout}s waiting for: ${description}" >&2
      return 1
    fi
    sleep 5
    waited=$(( waited + 5 ))
  done
  echo "OK: ${description}"
}

hr_ready_status() {
  kubectl -n demo get helmrelease demo-app \
    -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}'
}

hr_ready_message() {
  kubectl -n demo get helmrelease demo-app \
    -o jsonpath='{.status.conditions[?(@.type=="Ready")].message}'
}

hr_stalled_reason() {
  kubectl -n demo get helmrelease demo-app \
    -o jsonpath='{.status.conditions[?(@.type=="Stalled")].reason}'
}

hr_stalled_message() {
  kubectl -n demo get helmrelease demo-app \
    -o jsonpath='{.status.conditions[?(@.type=="Stalled")].message}'
}

gitrepo_ready_status() {
  kubectl -n flux-system get gitrepository flux-system \
    -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}'
}

kustomization_ready_status() {
  kubectl -n flux-system get kustomization apps \
    -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}'
}

hr_ready_is_true() {
  [[ "$(hr_ready_status)" == "True" ]]
}

gitrepo_ready_is_true() {
  [[ "$(gitrepo_ready_status)" == "True" ]]
}

kustomization_ready_is_true() {
  [[ "$(kustomization_ready_status)" == "True" ]]
}
