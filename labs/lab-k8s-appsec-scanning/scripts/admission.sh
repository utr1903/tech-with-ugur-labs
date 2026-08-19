#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=scripts/lib.sh
source scripts/lib.sh

KYVERNO_VERSION="v1.18.2" # latest stable at authoring time; verified compatible with kind's k8s v1.35.0
out="${TMP_DIR}/admission"
mkdir -p "${out}"
KCTX="kind-${CLUSTER}"

up() {
  kind get clusters 2>/dev/null | grep -qx "${CLUSTER}" || kind create cluster --name "${CLUSTER}"
  kubectl --context "${KCTX}" create namespace "${NAMESPACE}" \
    --dry-run=client -o yaml | kubectl --context "${KCTX}" apply -f -
  log "Installing Kyverno ${KYVERNO_VERSION}"
  # server-side apply: the Kyverno CRDs exceed the 256KiB last-applied-configuration
  # annotation limit that a client-side `kubectl apply` would try to write.
  kubectl --context "${KCTX}" apply --server-side --force-conflicts -f \
    "https://github.com/kyverno/kyverno/releases/download/${KYVERNO_VERSION}/install.yaml"
  kubectl --context "${KCTX}" -n kyverno rollout status deploy/kyverno-admission-controller --timeout=180s
  kubectl --context "${KCTX}" apply -f policy/kyverno/require-hardened.yaml
  log "Waiting for the Kyverno webhook to register"
  sleep 10
}

test_admission() {
  local rule
  rule="$(expected_ids admission kyverno | head -n1)"
  log "Admission: vulnerable manifest (expect DENY)"
  if kubectl --context "${KCTX}" apply --dry-run=server \
    -f vulnerable/k8s/deployment.yaml >"${out}/vulnerable.txt" 2>&1; then
    echo "UNEXPECTED: vulnerable manifest was admitted" >&2
    cat "${out}/vulnerable.txt"
    return 1
  fi
  grep -q "${rule}" "${out}/vulnerable.txt" \
    || {
      echo "deny message missing the policy rule name" >&2
      cat "${out}/vulnerable.txt"
      return 1
    }
  log "Admission: hardened manifest (expect ADMIT)"
  kubectl --context "${KCTX}" apply --dry-run=server \
    -f hardened/k8s/deployment.yaml >"${out}/hardened.txt" 2>&1 \
    || {
      echo "UNEXPECTED: hardened manifest was denied" >&2
      cat "${out}/hardened.txt"
      return 1
    }
  log "Admission OK: vulnerable denied, hardened admitted"
}

down() { kind delete cluster --name "${CLUSTER}" >/dev/null 2>&1 || true; }

case "${1:-all}" in
  up) up ;;
  test) test_admission ;;
  down) down ;;
  all) up && test_admission && down ;;
  *)
    echo "usage: admission.sh [up|test|down|all]" >&2
    exit 2
    ;;
esac
