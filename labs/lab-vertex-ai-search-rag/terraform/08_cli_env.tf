# Terraform hands the CLI its configuration directly. No output-copying step,
# and nothing reader-specific ends up tracked in git.
resource "local_file" "cli_env" {
  filename        = "${path.module}/../cli/.env"
  content         = local.cli_env
  file_permission = "0600"

  depends_on = [
    google_storage_bucket.corpus,
    google_discovery_engine_search_engine.app,
  ]
}
