resource "google_storage_bucket" "corpus" {
  project                     = var.project_id
  name                        = local.bucket_name
  location                    = var.region
  uniform_bucket_level_access = true
  force_destroy               = true

  depends_on = [google_project_service.storage]
}

# The import runs as the Discovery Engine service agent, not as you, and it
# needs two things on this bucket: to read the corpus and write its own error
# log (objectAdmin), and to look the bucket up in the first place
# (legacyBucketReader, which is what carries storage.buckets.get). Grant less
# than this and the import fails — first by trying to create a staging bucket
# of its own, then on the bucket lookup.
resource "google_storage_bucket_iam_member" "discoveryengine_object_admin" {
  bucket = google_storage_bucket.corpus.name
  role   = "roles/storage.objectAdmin"
  member = google_project_service_identity.discoveryengine.member
}

resource "google_storage_bucket_iam_member" "discoveryengine_bucket_reader" {
  bucket = google_storage_bucket.corpus.name
  role   = "roles/storage.legacyBucketReader"
  member = google_project_service_identity.discoveryengine.member
}

output "corpus_bucket" {
  description = "Cloud Storage bucket holding the corpus documents and the import metadata."
  value       = google_storage_bucket.corpus.name
}
