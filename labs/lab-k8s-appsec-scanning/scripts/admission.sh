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
  log "Waiting for the Kyverno admission webhook to start serving"
  local attempt policy_applied=""
  for attempt in $(seq 1 24); do
    if kubectl --context "${KCTX}" apply -f policy/kyverno/require-hardened.yaml \
      >"${out}/policy-apply.txt" 2>&1; then
      policy_applied="yes"
      break
    fi
    sleep 5
  done
  if [[ -z "${policy_applied}" ]]; then
    echo "Kyverno webhook never became ready; policy apply kept failing:" >&2
    cat "${out}/policy-apply.txt" >&2
    return 1
  fi
  log "Waiting for the Kyverno webhook to register for the ${NAMESPACE} namespace"
  sleep 10
}

test_admission() {
  local rule attempt
  rule="$(expected_ids admission kyverno | head -n1)"
  log "Admission: vulnerable manifest (expect DENY)"
  for attempt in $(seq 1 6); do
    if kubectl --context "${KCTX}" apply --dry-run=server \
      -f vulnerable/k8s/deployment.yaml >"${out}/vulnerable.txt" 2>&1; then
      echo "UNEXPECTED: vulnerable manifest was admitted" >&2
      cat "${out}/vulnerable.txt"
      return 1
    fi
    if grep -q "${rule}" "${out}/vulnerable.txt"; then
      break
    fi
    if [[ "${attempt}" -lt 6 ]] && grep -qiE \
      "connection refused|failed calling webhook|context deadline exceeded|no endpoints available|dial tcp" \
      "${out}/vulnerable.txt"; then
      log "Webhook not ready yet, retrying (${attempt}/6)"
      sleep 5
      continue
    fi
    break
  done
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
