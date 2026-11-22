#!/usr/bin/env bash
# Copies this lab into a new git repository of your own and fills in freshly generated
# fake secrets, so Aikido's secret scanning has something to find in YOUR private copy.
# The public lab only ever holds __FAKE_*__ placeholders.
set -euo pipefail

# shellcheck source-path=SCRIPTDIR source=lib/common.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/common.sh"

usage() {
  cat << 'EOF'
Usage: scripts/make-repo.sh <dest> [<owner>/<name>]   (or: make repo DEST=<dest> [GH_REPO=<owner>/<name>])

Copies the tracked lab files into <dest> (must not exist or be empty), replaces every
__FAKE_*__ placeholder with a random fake secret in a realistic format, and commits.
With <owner>/<name>, also creates that repo on GitHub as PRIVATE and pushes (needs gh).
EOF
}

# rand CHARSET LENGTH: random characters from /dev/urandom.
rand() {
  local out
  out="$(LC_ALL=C tr -dc "$1" < /dev/urandom | head -c "$2")" || true
  printf '%s' "$out"
}

# placeholder_values: "PLACEHOLDER VALUE" lines, one fresh value per placeholder.
placeholder_values() {
  printf '%s %s\n' \
    __FAKE_AWS_ACCESS_KEY_ID__ "AKIA$(rand 'A-Z2-7' 16)" \
    __FAKE_AWS_SECRET_ACCESS_KEY__ "$(rand 'A-Za-z0-9/+' 40)" \
    __FAKE_STRIPE_LIVE_KEY__ "sk_live_$(rand 'A-Za-z0-9' 24)" \
    __FAKE_STRIPE_LEGACY_KEY__ "sk_live_$(rand 'A-Za-z0-9' 24)" \
    __FAKE_SLACK_WEBHOOK_URL__ "https://hooks.slack.com/services/T$(rand 'A-Z0-9' 10)/B$(rand 'A-Z0-9' 10)/$(rand 'A-Za-z0-9' 24)" \
    __FAKE_INTERNAL_API_KEY__ "pbk_live_$(rand 'A-Za-z0-9' 24)" \
    __FAKE_JWT_SECRET__ "paybuddy-$(rand 'a-z0-9' 16)"
}

# abs_path PATH: absolute path of PATH, which may not exist yet (its parent may not either).
abs_path() {
  case "$1" in
    /*) printf '%s' "$1" ;;
    *) printf '%s/%s' "$PWD" "$1" ;;
  esac
}

# inside DIR ROOT: true when DIR is ROOT or below it (DIR's nearest existing ancestor decides).
inside() {
  local dir="$1" root="$2"
  while [[ ! -d "$dir" ]]; do dir="$(dirname "$dir")"; done
  dir="$(cd "$dir" && pwd -P)"
  [[ "$dir" == "$root" || "$dir" == "$root"/* ]]
}

copy_tracked_files() {
  local dest="$1"
  (cd "$LAB_DIR" && git ls-files -z | tar --null -T - -cf -) | (cd "$dest" && tar -xf -)
}

# The placeholders live in the app sources only (apps/); this script and its tests name them too.
inject_secrets() {
  local dest="$1" placeholder value f
  while read -r placeholder value; do
    while IFS= read -r f; do
      sed "s|$placeholder|$value|g" "$f" > "$f.tmp" && mv "$f.tmp" "$f"
    done < <(grep -rl -- "$placeholder" "$dest/apps" || true)
  done < <(placeholder_values)
}

main() {
  [[ $# -ge 1 && $# -le 2 && -n "$1" ]] || {
    usage >&2
    exit 2
  }
  local dest gh_repo="${2:-}" name top
  dest="$(abs_path "$1")"
  name="$(basename "${gh_repo:-$dest}")"

  top="$(git -C "$LAB_DIR" rev-parse --show-toplevel 2> /dev/null)" ||
    die "$LAB_DIR is not inside a git checkout; clone the labs repository first"
  top="$(cd "$top" && pwd -P)"
  if inside "$dest" "$top"; then
    die "$dest is inside the labs checkout ($top); choose a folder outside it, e.g. $HOME/$name"
  fi
  if [[ -e "$dest" && -n "$(ls -A "$dest" 2> /dev/null)" ]]; then
    die "$dest already exists and is not empty"
  fi

  log_step "Copying the lab into $dest"
  mkdir -p "$dest"
  copy_tracked_files "$dest"
  inject_secrets "$dest"
  ! grep -rq -- '__FAKE_' "$dest/apps" || die "a placeholder was left in $dest/apps"

  git -C "$dest" init -q -b main
  git -C "$dest" add -A
  git -C "$dest" commit -q -m "Import the Aikido code-to-cloud lab"
  log_info "committed; the fake secrets exist only in this copy"

  if [[ -n "$gh_repo" ]]; then
    command -v gh > /dev/null 2>&1 || die "gh is not installed; create the repo yourself: gh repo create $gh_repo --private --source $dest --push"
    log_step "Creating the private GitHub repo $gh_repo"
    gh repo create "$gh_repo" --private --source "$dest" --push
  else
    log_step "Next: push it to a PRIVATE GitHub repo of yours"
    log_info "gh repo create <owner>/$name --private --source $dest --push"
  fi
  log_info "Then connect that repo in Aikido (Repositories → add repository) and run the rest of the lab from $dest."
  log_info "Put this line in $dest/.env:"
  echo "AIKIDO_REPO_NAME=$name"
}

main "$@"
