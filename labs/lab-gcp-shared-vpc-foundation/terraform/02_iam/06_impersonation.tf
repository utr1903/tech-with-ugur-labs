resource "google_service_account_iam_member" "verifier_host" {
  service_account_id = google_service_account.host.name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = var.verifier_principal
}

resource "google_service_account_iam_member" "verifier_service_a" {
  service_account_id = google_service_account.service_a.name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = var.verifier_principal
}

resource "google_service_account_iam_member" "verifier_service_b" {
  service_account_id = google_service_account.service_b.name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = var.verifier_principal
}
