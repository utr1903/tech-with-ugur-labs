#!/usr/bin/env bash
# Source after defining k(): discover and wait within one total readiness bound.
wait_job_ready_pod() {
  local job=$1 namespace=$2 timeout=$3 deadline uid remaining pod current_uid
  deadline=$((SECONDS + timeout))
  uid=$(k --request-timeout="${timeout}s" get job "$job" -n "$namespace" -o jsonpath='{.metadata.uid}') || return 1
  test -n "$uid" || return 1
  while test "$SECONDS" -lt "$deadline"; do
    remaining=$((deadline - SECONDS))
    pod=$(k --request-timeout="${remaining}s" get pods -n "$namespace" -l "batch.kubernetes.io/controller-uid=${uid}" -o json | python3 -c '
import json
import sys
pods = [pod["metadata"]["name"] for pod in json.load(sys.stdin)["items"]
        if any(owner.get("uid") == sys.argv[1] and owner.get("kind") == "Job"
               and owner.get("controller") is True
               for owner in pod["metadata"].get("ownerReferences", []))]
if len(pods) > 1:
    raise SystemExit("ambiguous pods for current Job UID")
print(pods[0] if pods else "")
' "$uid") || return 1
    if test -n "$pod"; then
      remaining=$((deadline - SECONDS))
      test "$remaining" -gt 0 || break
      current_uid=$(k --request-timeout="${remaining}s" get job "$job" -n "$namespace" -o jsonpath='{.metadata.uid}') || return 1
      test "$current_uid" = "$uid" || return 1
      remaining=$((deadline - SECONDS))
      test "$remaining" -gt 0 || break
      k --request-timeout="${remaining}s" wait "pod/${pod}" -n "$namespace" --for=condition=Ready --timeout="${remaining}s" >&2 || return 1
      printf '%s\n' "$pod"
      return 0
    fi
    sleep 1
  done
  printf 'No Ready pod owned by Job %s UID %s within %ss\n' "$job" "$uid" "$timeout" >&2
  return 1
}
