resource "google_project_service" "apis" {
  for_each           = toset(["serviceusage.googleapis.com", "cloudresourcemanager.googleapis.com", "iam.googleapis.com", "iamcredentials.googleapis.com", "run.googleapis.com", "pubsub.googleapis.com", "artifactregistry.googleapis.com", "storage.googleapis.com", "logging.googleapis.com"])
  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}
resource "google_project_service_identity" "pubsub" {
  provider   = google-beta
  project    = var.project_id
  service    = "pubsub.googleapis.com"
  depends_on = [google_project_service.apis]
}
