#!/usr/bin/env bash
# Preflight for the lab: verifies on the host that the app will be able to
# reach AWS before any container is started. Prints one line per check.
set -u

. "$(dirname "$0")/settings.sh"

PROFILE="$(setting AWS_PROFILE)"
PROFILE="${PROFILE:-default}"
REGION="$(setting AWS_REGION)"
REGION="${REGION:-us-east-1}"
CACHE_DIR="${HOME}/.aws/login/cache"
CONFIG_FILE="${HOME}/.aws/config"
MIN_CLI="2.32.0"

# Regions that offer all three in-Region models.
IN_REGION_MODEL_REGIONS="us-east-1 us-east-2 us-west-2 eu-west-2 eu-north-1"

# Keep in sync with src/agent/models.ts.
MODELS="minimax-m2.5=minimax.minimax-m2.5
nemotron-super-3=nvidia.nemotron-super-3-120b
deepseek-v3.2=deepseek.v3.2
kimi-k3=global.moonshotai.kimi-k3"

failures=0
pass() { printf '  ok    %s\n' "$1"; }
fail() { printf '  FAIL  %s\n        %s\n' "$1" "$2"; failures=$((failures + 1)); }

# True when version $1 is at least version $2.
version_at_least() {
  [ "$(printf '%s\n%s\n' "$2" "$1" | sort -V | head -n 1)" = "$2" ]
}

# True when $1 only has characters a profile or Region name can contain, so
# an odd value from .env never reaches the aws command line.
is_valid_name() {
  case "$1" in *[!A-Za-z0-9._@+=,-]*) return 1 ;; esac
}

ALLOWED="Use only letters, digits and - _ . @ + = ,"
is_valid_name "$PROFILE" || fail "AWS_PROFILE in .env is not a valid value" "$ALLOWED"
is_valid_name "$REGION" || fail "AWS_REGION in .env is not a valid value" "$ALLOWED"
if [ "$failures" -gt 0 ]; then
  printf '\n%s check(s) failed.\n' "$failures"
  exit 1
fi

printf 'Checking profile "%s" in Region "%s"\n' "$PROFILE" "$REGION"

if ! command -v aws >/dev/null 2>&1; then
  fail "AWS CLI installed" "Install AWS CLI ${MIN_CLI} or newer."
  printf '\n1 check failed.\n'
  exit 1
fi

cli_version="$(aws --version 2>&1 | sed -n 's|^aws-cli/\([0-9.]*\).*|\1|p')"
if [ -n "$cli_version" ] && version_at_least "$cli_version" "$MIN_CLI"; then
  pass "AWS CLI ${cli_version}"
else
  fail "AWS CLI ${MIN_CLI} or newer" "Found \"${cli_version:-unknown}\". aws login needs ${MIN_CLI}."
fi

if [ -f "$CONFIG_FILE" ]; then
  pass "AWS config file exists"
else
  fail "AWS config file exists" "Run: make login"
fi

if [ -d "$CACHE_DIR" ]; then
  pass "Login cache directory exists"
else
  fail "Login cache directory exists" "Run: make login"
fi

if arn="$(aws sts get-caller-identity --profile "$PROFILE" --region "$REGION" --query Arn --output text 2>/dev/null)"; then
  pass "Signed in as ${arn}"
else
  fail "Signed in" "The session is missing or expired. Run: make login"
fi

case " $IN_REGION_MODEL_REGIONS " in
  *" $REGION "*) pass "Region offers the in-Region models" ;;
  *) fail "Region offers the in-Region models" "Use one of: ${IN_REGION_MODEL_REGIONS}" ;;
esac

while IFS='=' read -r key model_id; do
  if aws bedrock-runtime converse \
    --profile "$PROFILE" --region "$REGION" \
    --model-id "$model_id" \
    --messages '[{"role":"user","content":[{"text":"Reply with: ok"}]}]' \
    --inference-config '{"maxTokens":256}' \
    --query 'stopReason' --output text >/dev/null 2>&1; then
    pass "Model ${key} answers"
  else
    fail "Model ${key} answers" "No access to ${model_id} in ${REGION}. Request access in the Bedrock console."
  fi
done <<EOF
$MODELS
EOF

if [ "$failures" -gt 0 ]; then
  printf '\n%s check(s) failed.\n' "$failures"
  exit 1
fi
printf '\nAll checks passed.\n'
