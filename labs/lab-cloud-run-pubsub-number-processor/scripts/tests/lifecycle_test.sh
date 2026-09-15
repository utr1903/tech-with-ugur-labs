#!/usr/bin/env bash
# Removing ordering, immutable references, or restart guards must fail these tests.
set -euo pipefail
source_dir="$(cd "$(dirname "$0")/../.." && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/bin" "$tmp/lab/scripts" "$tmp/lab/terraform/"{foundation,services}
cp "$source_dir"/scripts/*.sh "$tmp/lab/scripts/" 2>/dev/null || true
export CALLS="$tmp/calls"
export PATH="$tmp/bin:$PATH"
cat > "$tmp/bin/terraform" <<'SH'
#!/usr/bin/env bash
set -eu
echo "terraform $*" >> "$CALLS"
if [[ "$*" == *"${FAIL_ON:-never-match}"* ]]; then exit 9; fi
if [[ "$*" == *'output -json deployment'* ]]; then
 echo '{"server_repository":"europe-west1-docker.pkg.dev/test-project/number-pipeline-server","processor_repository":"europe-west1-docker.pkg.dev/test-project/number-pipeline-processor","topic":"projects/test-project/topics/number-pipeline","bucket":"test-project-number-pipeline-results","server_sa":"number-pipeline-server@test-project.iam.gserviceaccount.com","processor_sa":"number-pipeline-processor@test-project.iam.gserviceaccount.com","push_sa":"number-pipeline-push@test-project.iam.gserviceaccount.com"}'
fi
SH
cat > "$tmp/bin/gcloud" <<'SH'
#!/usr/bin/env bash
set -eu
echo "gcloud $*" >> "$CALLS"
case "$*" in
 *'billing projects describe'*) echo '{"billingEnabled":true}';;
 *'projects describe'*) echo '{"lifecycleState":"ACTIVE","projectNumber":"123"}';;
 *'auth list'*) echo 'reader@example.com';;
 *'print-access-token'*) echo 'fake-token';;
 *'artifacts docker images describe'*) echo 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';;
 *) :;;
esac
SH
cat > "$tmp/bin/curl" <<'SH'
#!/usr/bin/env bash
echo '{"permissions":["serviceusage.services.enable"]}'
SH
cat > "$tmp/bin/docker" <<'SH'
#!/usr/bin/env bash
echo "docker $*" >> "$CALLS"
[[ "$*" != *"${FAIL_ON:-never-match}"* ]]
SH
chmod +x "$tmp/bin/"*
cd "$tmp/lab"
run() { bash scripts/deploy_cloud.sh "$@" > "$tmp/out" 2>&1; }
fail() { echo "FAIL: $*"; cat "$tmp/out"; exit 1; }
: > "$CALLS"
if run --bogus; then fail 'unknown flag accepted'; fi
[[ ! -s "$CALLS" ]] || fail 'unknown flag caused external calls'
if PROJECT_ID=test-project run --dry-run; then fail 'fresh plan needs explicit missing-image error'; fi
grep -q 'images' "$tmp/out" || fail 'missing image diagnostic absent'
if grep -Eq 'apply|buildx|push' "$CALLS"; then fail 'dry-run mutated cloud'; fi
grep -q 'foundation plan' "$CALLS" || fail 'fresh dry-run must preview foundation before missing-image error'
: > "$CALLS"
PROJECT_ID=test-project run || fail 'bootstrap failed'
[[ -f .lab/config.json && -f .lab/images.json ]] || fail 'bootstrap did not save config/images'
grep -q -- '--platform linux/amd64.*--push' "$CALLS" || fail 'image architecture/push missing'
grep -q 'server_image=.*@sha256:aaaa' "$CALLS" || fail 'services did not get digest image'
foundation_line=$(grep -n 'foundation apply' "$CALLS" | cut -d: -f1)
build_line=$(grep -n 'docker buildx build' "$CALLS" | head -1 | cut -d: -f1)
service_line=$(grep -n 'services apply' "$CALLS" | cut -d: -f1)
[[ $foundation_line -lt $build_line && $build_line -lt $service_line ]] || fail 'bootstrap ordering'
: > "$CALLS"
if PROJECT_ID=other-project run; then fail 'project drift accepted'; fi
[[ ! -s "$CALLS" ]] || fail 'drift caused external calls'
run --dry-run || fail 'existing plan failed'
if grep -Eq 'apply|buildx|push' "$CALLS"; then fail 'existing dry-run mutated cloud'; fi
cp .lab/config.json "$tmp/config.backup"
# Deliberately literal hostile input: the loader must treat it as data.
# shellcheck disable=SC2016
printf '%s' '{"project_id":"$(touch injected)","region":"europe-west1","lab_name":"number-pipeline","legacy_token_creator":false}' > .lab/config.json
if run; then fail 'malicious config accepted'; fi
[[ ! -e injected ]] || fail 'saved JSON executed shell input'
cp "$tmp/config.backup" .lab/config.json
: > "$CALLS"
run --dry-run --destroy || fail 'destroy preview failed'
[[ $(grep -c 'plan -destroy' "$CALLS") == 2 ]] || fail 'both roots need destroy preview'
: > "$CALLS"
if FAIL_ON='services destroy' run --destroy; then fail 'service failure swallowed'; fi
! grep -q 'foundation destroy' "$CALLS" || fail 'foundation destroyed after service failure'
[[ -f .lab/config.json ]] || fail 'failure discarded restart config'
: > "$CALLS"
if FAIL_ON='foundation destroy' run --destroy; then fail 'foundation failure swallowed'; fi
[[ -f .lab/config.json && -f .lab/images.json ]] || fail 'partial teardown discarded restart config'
run --destroy || fail 'retry teardown failed'
[[ ! -f .lab/config.json ]] || fail 'successful teardown retained active config'
: > "$CALLS"
if PROJECT_ID=test-project FAIL_ON='buildx build' run; then fail 'build failure swallowed'; fi
! grep -q 'services apply' "$CALLS" || fail 'services applied after build failure'
[[ -f .lab/config.json ]] || fail 'bootstrap failure discarded recovery config'
echo 'PASS: lifecycle ordering, flags, digest images, config guards, failures and restart'
