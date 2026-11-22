#!/usr/bin/env bats
# Tests for scripts/make-repo.sh: the public lab holds only placeholders, and the
# reader's private copy gets freshly generated fake secrets in realistic formats.
load helpers

LAB="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
SCRIPT="$LAB/scripts/make-repo.sh"

AWS_KEY_RE='AKIA[A-Z2-7]{16}'
AWS_SECRET_RE='secretAccessKey: "[A-Za-z0-9/+]{40}"'
STRIPE_RE='sk_live_[A-Za-z0-9]{24}'
SLACK_RE='https://hooks\.slack\.com/services/T[A-Z0-9]{10}/B[A-Z0-9]{10}/[A-Za-z0-9]{24}'
API_KEY_RE='pbk_live_[A-Za-z0-9]{24}'
JWT_RE='"paybuddy-[a-z0-9]{16}"'

setup() {
  # A private copy made by make-repo.sh holds generated secrets, not placeholders:
  # these checks are about the public lab, so they don't apply there.
  if ! grep -rq '__FAKE_' "$LAB/apps"; then
    skip "private copy (secrets already generated); make-repo checks apply to the public lab"
  fi
  T="$(mktemp -d)"
  export GIT_AUTHOR_NAME=Reader GIT_AUTHOR_EMAIL=reader@example.com
  export GIT_COMMITTER_NAME=Reader GIT_COMMITTER_EMAIL=reader@example.com
  mkdir -p "$T/bin"
  cat > "$T/bin/gh" << 'STUB'
#!/usr/bin/env bash
echo "$*" >> "$GH_CALLS"
STUB
  chmod +x "$T/bin/gh"
  export GH_CALLS="$T/gh.calls"
  PATH="$T/bin:$PATH"
}

stripe_key() { grep -oE "$STRIPE_RE" "$1/apps/server/src/config/integrations.ts"; }

@test "public tree has every placeholder and no secret-shaped literal" {
  grep -q '__FAKE_AWS_ACCESS_KEY_ID__' "$LAB/apps/server/src/config/integrations.ts"
  grep -q '__FAKE_AWS_SECRET_ACCESS_KEY__' "$LAB/apps/server/src/config/integrations.ts"
  grep -q '__FAKE_STRIPE_LIVE_KEY__' "$LAB/apps/server/src/config/integrations.ts"
  grep -q '__FAKE_STRIPE_LIVE_KEY__' "$LAB/apps/server/Dockerfile"
  grep -q '__FAKE_STRIPE_LEGACY_KEY__' "$LAB/apps/server/helm/values.yaml"
  grep -q '__FAKE_SLACK_WEBHOOK_URL__' "$LAB/apps/server/src/config/integrations.ts"
  grep -q '__FAKE_INTERNAL_API_KEY__' "$LAB/apps/server/src/agent/prompt.ts"
  grep -q '__FAKE_JWT_SECRET__' "$LAB/apps/server/src/auth/jwt.ts"
  run bash -c "cd '$LAB' && git ls-files -z | xargs -0 grep -nE 'AKIA[A-Z2-7]{16}|sk_live_[A-Za-z0-9]{10,}|hooks\.slack\.com/services/T[A-Z0-9]{8,}/|pbk_live_[A-Za-z0-9]{10,}|paybuddy-super-[s]ecret'"
  [ -z "$output" ]
}

@test "injects every secret in its format and leaves no placeholder" {
  dest="$T/my lab copy"
  run "$SCRIPT" "$dest"
  [ "$status" -eq 0 ]
  grep -qE "$AWS_KEY_RE" "$dest/apps/server/src/config/integrations.ts"
  grep -qE "$AWS_SECRET_RE" "$dest/apps/server/src/config/integrations.ts"
  grep -qE "$SLACK_RE" "$dest/apps/server/src/config/integrations.ts"
  grep -qE "$STRIPE_RE" "$dest/apps/server/helm/values.yaml"
  grep -qE "$API_KEY_RE" "$dest/apps/server/src/agent/prompt.ts"
  grep -qE "$JWT_RE" "$dest/apps/server/src/auth/jwt.ts"
  run grep -rl '__FAKE_' "$dest/apps"
  [ -z "$output" ]
  key="$(stripe_key "$dest")"
  grep -q "ENV STRIPE_KEY=$key" "$dest/apps/server/Dockerfile"
  grep -q "__FAKE_STRIPE_LIVE_KEY__" "$dest/scripts/make-repo.sh"
  [ "$(git -C "$dest" log --oneline | wc -l | tr -d ' ')" = 1 ]
  [ -z "$(git -C "$dest" status --porcelain)" ]
}

@test "copies exactly the tracked lab files" {
  dest="$T/copy"
  run "$SCRIPT" "$dest"
  [ "$status" -eq 0 ]
  diff <(cd "$LAB" && git ls-files | sort) <(git -C "$dest" ls-files | sort)
  [ ! -e "$dest/.env" ]
  [ ! -e "$dest/.state" ]
  [ ! -e "$dest/apps/server/node_modules" ]
}

@test "generates fresh values on every run" {
  "$SCRIPT" "$T/one" > /dev/null 2>&1
  "$SCRIPT" "$T/two" > /dev/null 2>&1
  [ -n "$(stripe_key "$T/one")" ]
  [ "$(stripe_key "$T/one")" != "$(stripe_key "$T/two")" ]
}

@test "accepts a relative destination" {
  cd "$T"
  run "$SCRIPT" rel-copy
  [ "$status" -eq 0 ]
  [ -f "$T/rel-copy/Makefile" ] || [ -f "$T/rel-copy/README.md" ]
  [ -d "$T/rel-copy/.git" ]
}

@test "refuses a non-empty destination" {
  mkdir -p "$T/busy"
  echo keep > "$T/busy/file"
  run "$SCRIPT" "$T/busy"
  [ "$status" -eq 1 ]
  [ "$(ls -A "$T/busy")" = "file" ]
}

@test "refuses a destination inside the labs checkout" {
  dest="$(git -C "$LAB" rev-parse --show-toplevel)/make-repo-test-$$"
  run "$SCRIPT" "$dest"
  [ "$status" -eq 1 ]
  [ ! -e "$dest" ]
}

@test "refuses to run without a destination" {
  run "$SCRIPT"
  [ "$status" -ne 0 ]
  [[ "$output" == *"Usage"* ]]
}

@test "creates a private GitHub repo when a name is given" {
  dest="$T/aikido-lab"
  run "$SCRIPT" "$dest" me/aikido-lab
  [ "$status" -eq 0 ]
  [ "$(cat "$GH_CALLS")" = "repo create me/aikido-lab --private --source $dest --push" ]
  [ "${lines[${#lines[@]}-1]}" = "AIKIDO_REPO_NAME=aikido-lab" ]
}

@test "prints the gh command when no name is given" {
  dest="$T/aikido-lab"
  run "$SCRIPT" "$dest"
  [ "$status" -eq 0 ]
  [ ! -e "$GH_CALLS" ]
  [[ "$output" == *"gh repo create <owner>/aikido-lab --private --source $dest --push"* ]]
  [ "${lines[${#lines[@]}-1]}" = "AIKIDO_REPO_NAME=aikido-lab" ]
}
