resource "google_storage_bucket" "data" {
  project       = google_project.this.project_id
  name          = "${local.name}-data-${random_id.suffix.hex}"
  location      = var.region
  force_destroy = true

  # INSECURE-BY-DESIGN: uniform bucket-level access disabled (per-object ACLs allowed)
  uniform_bucket_level_access = false

  # INSECURE-BY-DESIGN: object versioning disabled
  # (deliberately no versioning block)

  # INSECURE-BY-DESIGN: no retention policy
  # (deliberately no retention_policy block)

  depends_on = [time_sleep.org_policy, google_project_service.this]
}

resource "google_artifact_registry_repository" "this" {
  project       = google_project.this.project_id
  location      = var.region
  repository_id = "aikido-demo"
  format        = "DOCKER"

  depends_on = [google_project_service.this]
}
