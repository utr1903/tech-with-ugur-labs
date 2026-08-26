#!/usr/bin/env bash
set -euo pipefail

tf_dir="$(cd "$(dirname "$0")/../terraform" && pwd)"
env_file="$(cd "$(dirname "$0")/.." && pwd)/.env"

tf_out() {
  terraform -chdir="$tf_dir" output -raw "$1"
}

{
  echo "GCP_PROJECT_ID=$(tf_out project_id)"
  echo "CLOUDSQL_INSTANCE=$(tf_out instance_name)"
  echo "DB_HOST=$(tf_out public_ip)"
  echo "DB_PORT=5432"
  echo "DB_NAME=$(tf_out db_name)"
  echo "DB_USER=$(tf_out db_user)"
  echo "DB_PASSWORD=$(tf_out db_password)"
  echo "LOG_LEVEL=info"
} > "$env_file"

echo "Wrote $env_file (gitignored; contains the database password)"
