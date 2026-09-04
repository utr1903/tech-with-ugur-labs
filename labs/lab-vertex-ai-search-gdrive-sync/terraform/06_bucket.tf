resource "google_storage_bucket" "staging" {
  project                     = var.project_id
  name                        = local.bucket_name
  location                    = var.region
  uniform_bucket_level_access = true
  force_destroy               = true

  depends_on = [google_project_service.storage]
}

# The import needs to read the staged documents AND write its own error log, so
# objectViewer is not enough: with only read access it tries to create a staging
# bucket of its own and fails on storage.buckets.create.
resource "google_storage_bucket_iam_member" "discoveryengine_object_admin" {
  bucket = google_storage_bucket.staging.name
  role   = "roles/storage.objectAdmin"
  member = google_project_service_identity.discoveryengine.member
}

# legacyBucketReader is what actually carries storage.buckets.get, which the
# import calls before it reads anything.
resource "google_storage_bucket_iam_member" "discoveryengine_bucket_reader" {
  bucket = google_storage_bucket.staging.name
  role   = "roles/storage.legacyBucketReader"
  member = google_project_service_identity.discoveryengine.member
}

output "staging_bucket" {
  description = "Cloud Storage bucket the exported documents are staged into."
  value       = google_storage_bucket.staging.name
}
