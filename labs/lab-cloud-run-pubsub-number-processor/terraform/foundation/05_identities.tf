resource "google_service_account" "apps" {
  for_each     = toset(["server", "processor", "push"])
  account_id   = "${var.lab_name}-${each.value}"
  display_name = "Number pipeline ${each.value}"
  depends_on   = [google_project_service.apis]
}
resource "google_service_account_iam_member" "legacy_token_creator" {
  count              = var.legacy_token_creator ? 1 : 0
  service_account_id = google_service_account.apps["push"].name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "serviceAccount:${google_project_service_identity.pubsub.email}"
}
