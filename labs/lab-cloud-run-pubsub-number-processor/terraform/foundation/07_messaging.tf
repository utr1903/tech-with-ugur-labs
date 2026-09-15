resource "google_pubsub_topic" "numbers" {
  name       = var.lab_name
  depends_on = [google_project_service.apis]
}
resource "google_pubsub_topic_iam_member" "publisher" {
  topic  = google_pubsub_topic.numbers.name
  role   = "roles/pubsub.publisher"
  member = "serviceAccount:${google_service_account.apps["server"].email}"
}
