resource "google_storage_bucket" "results" {
  name                        = local.bucket
  location                    = var.region
  force_destroy               = true
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  soft_delete_policy { retention_duration_seconds = 0 }
  depends_on = [google_project_service.apis]
}
resource "google_storage_bucket_iam_member" "creator" {
  bucket = google_storage_bucket.results.name
  role   = "roles/storage.objectCreator"
  member = "serviceAccount:${google_service_account.apps["processor"].email}"
}
output "deployment" {
  value = {
    server_repository    = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.images["server"].repository_id}"
    processor_repository = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.images["processor"].repository_id}"
    topic                = google_pubsub_topic.numbers.id
    bucket               = google_storage_bucket.results.name
    server_sa            = google_service_account.apps["server"].email
    processor_sa         = google_service_account.apps["processor"].email
    push_sa              = google_service_account.apps["push"].email
  }
}
