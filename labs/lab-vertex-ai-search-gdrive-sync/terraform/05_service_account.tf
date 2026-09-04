# This service account exists to be a Drive principal and nothing else. It holds
# no project IAM roles: no IAM role of any kind grants access to Drive content.
# Its access comes entirely from being added to the shared drive as Content
# manager, which is a manual step in the README.
resource "google_service_account" "corpus_sync" {
  project      = var.project_id
  account_id   = local.sync_sa_id
  display_name = "Corpus sync (Drive reader for the Vertex AI Search lab)"
}

# No key is ever created. The operator mints short-lived tokens for this account
# instead, which is why they need Token Creator on it.
resource "google_service_account_iam_member" "operator_can_impersonate" {
  service_account_id = google_service_account.corpus_sync.name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "user:${data.google_client_openid_userinfo.operator.email}"
}

output "sync_service_account" {
  description = "Add this address to your shared drive as Content manager."
  value       = google_service_account.corpus_sync.email
}
