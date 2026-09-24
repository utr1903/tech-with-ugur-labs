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
