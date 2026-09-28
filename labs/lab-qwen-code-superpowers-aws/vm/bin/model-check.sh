#!/usr/bin/env bash
# Proves the model is usable by an agent: it is listed, it answers a
# tool-call request with a parsed tool call, and it generates at a measured
# speed. With --wait SECONDS it first waits for vLLM to become healthy
# (the first start downloads about 80 GB of weights).
set -euo pipefail

base="http://127.0.0.1:8000"
compose=(docker compose -f /srv/lab/vm/compose.yaml)
wait_seconds=0
if [ "${1:-}" = "--wait" ]; then wait_seconds="${2:?--wait needs seconds}"; fi

# Read one value; never source .env (VLLM_EXTRA_ARGS may hold JSON).
served="$(sed -n 's/^SERVED_MODEL_NAME=//p' /srv/lab/vm/.env)"

deadline=$(( $(date +%s) + wait_seconds ))
until curl -sf "$base/health" >/dev/null; do
  if [ "$("${compose[@]}" ps --status exited -q vllm)" != "" ]; then
    echo "vLLM exited. Last log lines:" >&2
    "${compose[@]}" logs --tail 40 vllm >&2
    exit 1
  fi
  if [ "$(date +%s)" -ge "$deadline" ]; then
    echo "vLLM is not healthy. Last log lines:" >&2
    "${compose[@]}" logs --tail 20 vllm >&2
    exit 1
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
' "$served"

curl -sf "$base/v1/chat/completions" -H 'Content-Type: application/json' -d @- <<EOF | python3 -c '
import json, sys
message = json.load(sys.stdin)["choices"][0]["message"]
calls = message.get("tool_calls") or []
if not calls or calls[0]["function"]["name"] != "get_weather":
    sys.exit(f"no parsed tool call; message was: {message}")
args = json.loads(calls[0]["function"]["arguments"])
if "berlin" not in str(args.get("city", "")).lower():
    sys.exit(f"unexpected tool arguments: {args}")
print("  ok    tool call parsed:", calls[0]["function"]["name"], args)
'
{"model": "$served",
 "messages": [{"role": "user", "content": "What is the weather in Berlin right now? Use the get_weather tool."}],
 "tools": [{"type": "function", "function": {"name": "get_weather",
   "description": "Current weather for a city",
   "parameters": {"type": "object", "properties": {"city": {"type": "string"}}, "required": ["city"]}}}],
 "tool_choice": "auto", "max_tokens": 256}
EOF

start=$(date +%s.%N)
tokens=$(curl -sf "$base/v1/chat/completions" -H 'Content-Type: application/json' -d "{\"model\": \"$served\", \"messages\": [{\"role\": \"user\", \"content\": \"Write a long story about a lighthouse keeper.\"}], \"max_tokens\": 512, \"ignore_eos\": true}" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["usage"]["completion_tokens"])')
end=$(date +%s.%N)
python3 -c "import sys; t=float(sys.argv[1]); s=float(sys.argv[3])-float(sys.argv[2]); print(f'  info  {t:.0f} tokens in {s:.1f} s = {t/s:.0f} tokens/s (single request)')" "$tokens" "$start" "$end"
nvidia-smi --query-gpu=name,memory.used,memory.total --format=csv,noheader | sed 's/^/  info  GPU /' || true
