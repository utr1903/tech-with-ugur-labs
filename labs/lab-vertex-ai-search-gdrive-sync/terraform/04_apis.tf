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

# Creating the service account itself, and granting Token Creator on it, needs
# the IAM API. This is separate from iamcredentials, which only mints tokens for
# an account that already exists.
resource "google_project_service" "iam" {
  project            = var.project_id
  service            = "iam.googleapis.com"
  disable_on_destroy = false
}

# The verification suite edits a Google Doc in place through documents.batchUpdate
# to prove that an edit in Drive changes the answer. That is the Docs API, not the
# Drive API — a distinction that only shows up at `npm run verify`, right at the
# end of the run, if this is missing.
resource "google_project_service" "docs" {
  project            = var.project_id
  service            = "docs.googleapis.com"
  disable_on_destroy = false
}

# Enabling an API and using it in the same apply is a race: the enablement is
# accepted before it has propagated, and the next call fails with
# SERVICE_DISABLED. Everything that needs a freshly enabled API waits on this.
resource "time_sleep" "api_propagation" {
  create_duration = "30s"

  depends_on = [
    google_project_service.discoveryengine,
    google_project_service.docs,
    google_project_service.drive,
    google_project_service.iam,
    google_project_service.iamcredentials,
    google_project_service.storage,
  ]
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
