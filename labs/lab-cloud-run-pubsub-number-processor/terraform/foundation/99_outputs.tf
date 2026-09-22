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
