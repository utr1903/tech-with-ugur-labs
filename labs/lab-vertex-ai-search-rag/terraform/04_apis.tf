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

# The import job runs as the Discovery Engine service agent, not as you.
# Creating the identity explicitly means the bucket grant below can never
# race ahead of the account it grants to.
resource "google_project_service_identity" "discoveryengine" {
  provider = google-beta

  project = var.project_id
  service = "discoveryengine.googleapis.com"

  depends_on = [google_project_service.discoveryengine]
}
