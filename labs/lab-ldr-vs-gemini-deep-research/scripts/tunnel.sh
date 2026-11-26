#!/usr/bin/env bash
# Opens, closes or reports the SSH tunnel that carries the laptop's
# 127.0.0.1:8000 to the model on the VM.
set -euo pipefail

lab_dir="$(cd "$(dirname "$0")/.." && pwd)"
vm_ssh="$lab_dir/scripts/vm_ssh.sh"

case "${1:-}" in
  open)
    if "$vm_ssh" tunnel-status >/dev/null 2>&1; then
      echo "The tunnel is already open."
    else
      echo "Opening the tunnel to the VM..."
      "$vm_ssh" tunnel-open || { echo "tunnel: opening the tunnel failed." >&2; exit 1; }
    fi
    for _ in 1 2 3 4 5 6 7 8 9 10; do
      if curl -fsS --max-time 5 http://127.0.0.1:8000/v1/models >/dev/null 2>&1; then
        echo "The model answers at http://127.0.0.1:8000/v1/models."
        exit 0
      fi
      sleep 2
    done
    echo "tunnel: the tunnel is open but http://127.0.0.1:8000/v1/models does not answer (is vLLM running on the VM?)." >&2
    exit 1
    ;;
  close)
    if "$vm_ssh" tunnel-status >/dev/null 2>&1; then
      "$vm_ssh" tunnel-close || { echo "tunnel: closing the tunnel failed." >&2; exit 1; }
      echo "The tunnel is closed."
    else
      echo "The tunnel is not open."
    fi
    ;;
  status)
    "$vm_ssh" tunnel-status
    ;;
  *)
    echo "usage: $0 open|close|status" >&2
    exit 1
    ;;
esac
