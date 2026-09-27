#!/usr/bin/env bash
# Signs in with `aws login` to the same profile the app will use: the
# AWS_PROFILE from the environment or .env, else "default".
set -eu

. "$(dirname "$0")/settings.sh"

profile="$(setting AWS_PROFILE)"
exec aws login --profile "${profile:-default}"
