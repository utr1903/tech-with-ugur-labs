resource "google_pubsub_subscription" "processor" {
  name                       = "${var.lab_name}-push"
  topic                      = local.topic
  ack_deadline_seconds       = 60
  message_retention_duration = "86400s"
  expiration_policy { ttl = "" }
  retry_policy {
    minimum_backoff = "10s"
    maximum_backoff = "60s"
  }
  push_config {
    push_endpoint = google_cloud_run_v2_service.processor.uri
    oidc_token {
      service_account_email = local.push_sa
      audience              = google_cloud_run_v2_service.processor.uri
    }
  }
  depends_on = [google_cloud_run_v2_service_iam_member.processor_invoker]
}
