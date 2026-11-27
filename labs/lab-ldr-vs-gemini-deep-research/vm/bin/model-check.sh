#!/usr/bin/env bash
# Runs ON the VM. Proves the model is usable: it is listed, it answers a
# chat request, it returns a parsed tool call, and it generates at a measured
# speed. With --wait SECONDS it first waits for vLLM to become healthy (the
# first start downloads about 29 GB of weights).
set -euo pipefail

base="http://127.0.0.1:8000"
compose=(docker compose -f /srv/lab/vm/compose.yaml)
wait_seconds=0
if [ "${1:-}" = "--wait" ]; then wait_seconds="${2:?--wait needs seconds}"; fi

die() { echo "model-check: $1 failed: $2" >&2; exit 1; }

# Read one value; never source .env (SERVE_EXTRA_ARGS may hold JSON).
served="$(sed -n 's/^SERVED_MODEL_NAME=//p' /srv/lab/vm/.env)"
[ -n "$served" ] || die "reading the served model name" "SERVED_MODEL_NAME missing in /srv/lab/vm/.env"

deadline=$(( $(date +%s) + wait_seconds ))
until curl -sf "$base/health" >/dev/null; do
  if [ -n "$("${compose[@]}" ps --status exited -q vllm)" ]; then
    echo "vLLM exited. Last log lines:" >&2
    "${compose[@]}" logs --tail 40 vllm >&2
    die "waiting for vLLM" "the container exited"
  fi
  # restart: unless-stopped means a crash never leaves vLLM "exited"; watch
  # the restart count too. The container can vanish from `docker inspect`
  # between restarts, which just counts as "no restarts yet".
  container_id="$("${compose[@]}" ps -a -q vllm)"
  restart_count="$(docker inspect -f '{{.RestartCount}}' "$container_id" 2>/dev/null || echo 0)"
  if [ -n "$container_id" ] && [ "${restart_count:-0}" -gt 0 ]; then
    echo "vLLM crashed and was restarted; root cause:" >&2
    root_cause="$("${compose[@]}" logs --tail 60 vllm 2>/dev/null | grep -E 'Error|ERROR|raise|ValueError|RuntimeError|OutOfMemory' || true)"
    if [ -n "$root_cause" ]; then
      printf '%s\n' "$root_cause" >&2
    else
      "${compose[@]}" logs --tail 60 vllm >&2
    fi
    echo "To reset the restart count after fixing the cause: docker compose -f /srv/lab/vm/compose.yaml up -d --force-recreate vllm" >&2
    die "waiting for vLLM" "the container crashed and restarted"
  fi
  if [ "$(date +%s)" -ge "$deadline" ]; then
    echo "vLLM is not healthy. Last log lines:" >&2
    "${compose[@]}" logs --tail 20 vllm >&2
    die "waiting for vLLM" "not healthy within ${wait_seconds} s"
  fi
  echo "Waiting for vLLM: $("${compose[@]}" logs --tail 1 --no-log-prefix vllm 2>/dev/null | cut -c1-120)"
  sleep 30
done

curl -sf "$base/v1/models" | python3 -c '
import json, sys
names = [m["id"] for m in json.load(sys.stdin)["data"]]
want = sys.argv[1]
if want not in names:
    sys.exit(f"model {want} not served; got {names}")
print(f"  ok    model {want} is served")
' "$served" || die "model listing" "$served is not listed by /v1/models"

# max_tokens leaves room for the reasoning the parser strips from content.
chat_body="$(python3 -c '
import json, sys
print(json.dumps({"model": sys.argv[1],
  "messages": [{"role": "user", "content": "Reply with the single word ready."}],
  "max_tokens": 2048}))
' "$served")"
curl -sf "$base/v1/chat/completions" -H 'Content-Type: application/json' -d "$chat_body" | python3 -c '
import json, sys
choice = json.load(sys.stdin)["choices"][0]
message = choice["message"]
content = (message.get("content") or "").strip()
if not content:
    reason = choice.get("finish_reason")
    sys.exit(f"empty content; finish_reason={reason}; message was: {message}")
print("  ok    chat completion answered:", content[:60])
' || die "chat completion" "no non-empty content"

# With the reasoning parser on, content may be empty while tool_calls is set.
tool_body="$(python3 -c '
import json, sys
print(json.dumps({"model": sys.argv[1],
  "messages": [{"role": "user", "content": "What is the weather in Berlin? Use the tool."}],
  "tools": [{"type": "function", "function": {"name": "get_weather",
    "description": "Current weather for a city",
    "parameters": {"type": "object", "properties": {"city": {"type": "string"}}, "required": ["city"]}}}],
  "tool_choice": "auto", "max_tokens": 2048}))
' "$served")"
curl -sf "$base/v1/chat/completions" -H 'Content-Type: application/json' -d "$tool_body" | python3 -c '
import json, sys
choice = json.load(sys.stdin)["choices"][0]
message = choice["message"]
calls = message.get("tool_calls") or []
wanted = [c for c in calls if c["function"]["name"] == "get_weather"]
if not wanted:
    reason = choice.get("finish_reason")
    sys.exit(f"no parsed tool call; finish_reason={reason}; message was: {message}")
print("  ok    tool call parsed:", wanted[0]["function"]["name"], wanted[0]["function"]["arguments"])
# A thinking model sometimes also emits the chat template example call.
others = sorted({c["function"]["name"] for c in calls} - {"get_weather"})
if others:
    print("  warn  the reply also held calls to:", ", ".join(others))
' || die "tool call" "no parsed get_weather call"

speed_body="$(python3 -c '
import json, sys
print(json.dumps({"model": sys.argv[1],
  "messages": [{"role": "user", "content": "Write a long story about a lighthouse keeper."}],
  "max_tokens": 512, "ignore_eos": True}))
' "$served")"
start="$(python3 -c 'import time; print(time.time())')"
tokens="$(curl -sf "$base/v1/chat/completions" -H 'Content-Type: application/json' -d "$speed_body" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["usage"]["completion_tokens"])')" ||
  die "speed measurement" "the request failed"
end="$(python3 -c 'import time; print(time.time())')"
python3 -c "import sys; t=float(sys.argv[1]); s=float(sys.argv[3])-float(sys.argv[2]); print(f'  info  {t:.0f} tokens in {s:.1f} s = {t/s:.1f} tokens/s (single request)')" "$tokens" "$start" "$end"
nvidia-smi --query-gpu=memory.used,memory.total --format=csv,noheader | sed 's/^/  info  GPU memory used, total: /' || true
