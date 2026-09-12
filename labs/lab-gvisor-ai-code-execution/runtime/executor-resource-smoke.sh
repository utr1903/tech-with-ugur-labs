#!/usr/bin/env bash
# Run fixed-source probes; classify from Kubernetes, never printed source fields.
set -euo pipefail
runtime_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
: "${GVISOR_KUBECONFIG:?Set the absolute owned kubeconfig}"
: "${GVISOR_CLUSTER_NAME:?Set the owned kind cluster name}"
: "${GVISOR_RUNNER_IMAGE:?Set the imported runner OCI manifest image reference}"
case "$GVISOR_KUBECONFIG" in /*) ;; *) exit 1 ;; esac
kube() { kubectl --kubeconfig "$GVISOR_KUBECONFIG" --context "kind-$GVISOR_CLUSTER_NAME" "$@"; }
job=''
cleanup() { if test -n "$job"; then kube delete job "$job" -n executor --ignore-not-found --wait=true --timeout=30s; fi; }
trap cleanup EXIT
probes=(calculation nonzero flood cpu eof-timeout eof-success filesystem oom fork threads kill stop)
if test "$#" -gt 0; then probes=("$@"); fi
for probe in "${probes[@]}"; do
  case "$probe" in
    calculation) source='print(6 * 7)' ;;
    nonzero) source='import sys; print("status:succeeded"); sys.stderr.write("error-marker"); sys.exit(7)' ;;
    flood) source='import os; os.write(1,b"x"*1000000); os.write(2,b"y"*1000000)' ;;
    cpu) source=$'print("deadline-marker",flush=True)\nwhile True: pass' ;;
    eof-timeout) source='import os,time; os.close(1); os.close(2); time.sleep(15)' ;;
    eof-success) source='import os,time; os.close(1); os.close(2); time.sleep(.2)' ;;
    filesystem) source=$'import os\ntry:\n for i in range(3):\n  with open("/work/"+str(i),"wb") as f: f.write(b"x"*10000000)\nexcept OSError as e: print("errno",e.errno)\nprint("bytes",sum(os.stat("/work/"+x).st_size for x in os.listdir("/work")))' ;;
    oom) source=$'import time; print("oom-marker",flush=True); time.sleep(.3)\na=[]\nwhile True: a.append(bytearray(10000000))' ;;
    fork) source=$'import os,time\nkids=[]\ntry:\n for i in range(100):\n  pid=os.fork()\n  if pid==0: time.sleep(5); os._exit(0)\n  kids.append(pid)\nexcept OSError as e: print("fork-denied",e.errno,"children",len(kids),flush=True)\nfor pid in kids: os.waitpid(pid,0)' ;;
    threads) source=$'import threading,time\nts=[]\ntry:\n for i in range(100):\n  t=threading.Thread(target=lambda:time.sleep(2)); t.start(); ts.append(t)\nexcept RuntimeError: print("thread-denied",len(ts),flush=True)\nfor t in ts: t.join()' ;;
    kill) source='import os,signal,time; print("tamper-marker",flush=True); time.sleep(.3); os.kill(os.getppid(),signal.SIGKILL)' ;;
    stop) source='import os,signal,time; print("stop-marker",flush=True); time.sleep(.3); os.kill(os.getppid(),signal.SIGSTOP); time.sleep(60)' ;;
    *) printf 'Unknown fixed probe: %s\n' "$probe" >&2; exit 2 ;;
  esac
  job="executor-${probe}-$$"
  jq --arg name "$job" --arg image "$GVISOR_RUNNER_IMAGE" --arg source "$source" '.metadata.name=$name | .spec.template.spec.containers[0].image=$image | .spec.template.spec.containers[0].env[0].value=$source' "$runtime_dir/runner-job.json" | kube create --as=system:serviceaccount:executor-app:backend -f -
  uid=$(kube get job "$job" -n executor -o jsonpath='{.metadata.uid}')
  deadline=$((SECONDS + 35)); pod=''; terminated='null'; early_logs=''; remaining_log_bytes=32768
  while test "$SECONDS" -lt "$deadline"; do
    pods=$(kube get pods -n executor -l "batch.kubernetes.io/controller-uid=$uid" -o json)
    pod=$(jq -r '.items[0].metadata.name // empty' <<< "$pods")
    terminated=$(jq -c '.items[0].status.containerStatuses[0].state.terminated // null' <<< "$pods")
    test "$terminated" != null && break
    # Deadline cleanup can delete the Pod between terminal-status observation and logs.
    # Retain stopped-supervisor diagnostics while it is still running, within one budget.
    if test "$probe" = stop && ! grep -q 'c3RvcC1tYXJrZXIK' <<< "$early_logs" && test -n "$pod" && jq -e 'any(.items[0].status.containerStatuses[]?; .state.running != null)' <<< "$pods" >/dev/null; then
      test "$remaining_log_bytes" -gt 0
      early_logs=$(kube logs "$pod" -n executor --limit-bytes="$remaining_log_bytes")
      snapshot_bytes=$(LC_ALL=C printf '%s\n' "$early_logs" | wc -c)
      remaining_log_bytes=$((remaining_log_bytes - snapshot_bytes))
      test "$remaining_log_bytes" -ge 0
    fi
    sleep .2
  done
  test -n "$pod" && test "$terminated" != null
  if test "$probe" = stop; then logs=$early_logs; else logs=$(kube logs "$pod" -n executor --limit-bytes=32768); fi
  stdout=$(jq -r 'select(.captureVersion==1 and .stream=="stdout") | .dataB64 | @base64d' <<< "$logs")
  code=$(jq -r '.exitCode' <<< "$terminated")
  case "$probe" in
    calculation) test "$code" = 0 && test "$stdout" = 42 ;;
    nonzero) test "$code" = 7 ;;
    flood) test "$code" = 0 && test "$(jq -s '[.[] | select(.stream=="stdout") | .dataB64 | @base64d | length] | add' <<< "$logs")" = 8192 && test "$(jq -s '[.[] | select(.stream=="stderr") | .dataB64 | @base64d | length] | add' <<< "$logs")" = 8192 ;;
    cpu) test "$code" = 124 && test "$stdout" = deadline-marker ;;
    eof-timeout) test "$code" = 124 && test -z "$stdout" ;;
    eof-success) test "$code" = 0 && test -z "$stdout" ;;
    filesystem) test "$code" = 0 && grep -q 'errno 28' <<< "$stdout"; bytes=$(awk '$1=="bytes" {print $2}' <<< "$stdout"); test "$bytes" -ge 15000000 && test "$bytes" -le 16777216 ;;
    oom) test "$(jq -r '.reason' <<< "$terminated")" = OOMKilled && test "$stdout" = oom-marker ;;
    fork) test "$code" = 0 && grep -q 'fork-denied 11' <<< "$stdout" ;;
    threads) test "$code" = 0 && grep -q thread-denied <<< "$stdout" ;;
    kill) test "$code" = 137 && test "$stdout" = tamper-marker && test "$(jq -s 'any(.[]; .captureComplete==true)' <<< "$logs")" = false ;;
    stop) test "$code" = 137 && test "$stdout" = stop-marker; kube get job "$job" -n executor -o json | jq -e 'any(.status.conditions[]; .reason=="DeadlineExceeded")' ;;
  esac
  if test "$probe" = stop; then printf 'stop log bytes retrieved: %s\n' "$((32768 - remaining_log_bytes))"; fi
  printf '%s: %s\n' "$probe" "$terminated"
  cleanup
  job=''
done
printf 'Resource and supervisor probes passed; printed claims remained advisory\n'
