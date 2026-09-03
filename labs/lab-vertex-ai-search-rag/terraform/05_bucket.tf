resource "google_storage_bucket" "corpus" {
  project                     = var.project_id
  name                        = local.bucket_name
  location                    = var.region
  uniform_bucket_level_access = true
  force_destroy               = true

  depends_on = [google_project_service.storage]
}

resource "google_storage_bucket_iam_member" "discoveryengine_reader" {
  bucket = google_storage_bucket.corpus.name
  role   = "roles/storage.objectViewer"
  member = google_project_service_identity.discoveryengine.member
}

output "corpus_bucket" {
  description = "Cloud Storage bucket holding the corpus documents and the import metadata."
  value       = google_storage_bucket.corpus.name
}
