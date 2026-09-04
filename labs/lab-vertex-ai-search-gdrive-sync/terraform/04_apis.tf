resource "google_project_service" "discoveryengine" {
  project            = var.project_id
  service            = "discoveryengine.googleapis.com"
  disable_on_destroy = false
}

resource "google_project_service" "storage" {
  project            = var.project_id
  service            = "storage.googleapis.com"
  disable_on_destroy = false
}

# Drive API calls authenticate as the service account but bill their quota to
# this project. Nothing is enabled on the Workspace side.
resource "google_project_service" "drive" {
  project            = var.project_id
  service            = "drive.googleapis.com"
  disable_on_destroy = false
}

# Impersonation goes through generateAccessToken on this API.
resource "google_project_service" "iamcredentials" {
  project            = var.project_id
  service            = "iamcredentials.googleapis.com"
  disable_on_destroy = false
}

# The import job runs as the Discovery Engine service agent, not as you.
# Creating the identity explicitly means the bucket grants below cannot race
# ahead of the account they grant to.
resource "google_project_service_identity" "discoveryengine" {
  provider = google-beta

  project = var.project_id
  service = "discoveryengine.googleapis.com"

  depends_on = [google_project_service.discoveryengine]
}
