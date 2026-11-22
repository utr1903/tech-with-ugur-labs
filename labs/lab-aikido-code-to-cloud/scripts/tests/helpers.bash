# Shared bats helpers: a fake `curl` on PATH that serves canned responses.
#
# stub_response METHOD PATH CODE BODY
#   Queues one response for METHOD + PATH (path after the host, incl. query).
#   Several calls queue a sequence; the last one repeats once the queue is used up.
# Every call is logged to $STUB_DIR/calls as "METHOD PATH BODY" (an @file body is resolved to its content)
# and its raw argv to $STUB_DIR/argv.

LIB_DIR="$(cd "$BATS_TEST_DIRNAME/../lib" && pwd)"

setup_stubs() {
  STUB_DIR="$(mktemp -d)"
  export STUB_DIR
  mkdir -p "$STUB_DIR/bin" "$STUB_DIR/resp"
  : > "$STUB_DIR/calls"
  : > "$STUB_DIR/argv"
  cat > "$STUB_DIR/bin/curl" <<'STUB'
#!/usr/bin/env bash
method=GET url="" data="" fmt=""
echo "$*" >> "$STUB_DIR/argv"   # what a process listing would show
while [[ $# -gt 0 ]]; do
  case "$1" in
    -X) method="$2"; shift 2 ;;
    --data-binary) data="$2"; [[ "$data" == @* ]] && data="$(cat "${data#@}")"; shift 2 ;;
    -d|--data) data="$2"; shift 2 ;;
    -w) fmt="$2"; shift 2 ;;
    -H|--config|-u) shift 2 ;;
    http*) url="$1"; shift ;;
    *) shift ;;
  esac
done
cat > /dev/null   # swallow headers / config from stdin
path="/${url#*://*/}"
echo "$method $path $data" >> "$STUB_DIR/calls"
key="$(printf '%s_%s' "$method" "$path" | tr -c 'A-Za-z0-9' '_')"
n_file="$STUB_DIR/resp/$key.n"
n=$(( $(cat "$n_file" 2>/dev/null || echo 0) + 1 ))
if [[ -f "$STUB_DIR/resp/$key.$n" ]]; then echo "$n" > "$n_file"; else n=$(cat "$n_file" 2>/dev/null || echo 1); fi
f="$STUB_DIR/resp/$key.$n"
if [[ ! -f "$f" ]]; then code=599; body="no stub for $method $path"; else code="$(head -1 "$f")"; body="$(tail -n +2 "$f")"; fi
printf '%s' "$body"
[[ -n "$fmt" ]] && printf '\n%s' "$code"
exit 0
STUB
  chmod +x "$STUB_DIR/bin/curl"
  PATH="$STUB_DIR/bin:$PATH"
}

stub_response() {
  local key i=1
  key="$(printf '%s_%s' "$1" "$2" | tr -c 'A-Za-z0-9' '_')"
  while [[ -f "$STUB_DIR/resp/$key.$i" ]]; do i=$((i + 1)); done
  printf '%s\n%s' "$3" "$4" > "$STUB_DIR/resp/$key.$i"
}

# Number of logged calls matching a grep -E pattern.
calls_matching() { grep -cE "$1" "$STUB_DIR/calls" || true; }

stub_token() { stub_response POST /api/oauth/token 200 '{"access_token":"tok-SECRET-123","expires_in":3600}'; }
