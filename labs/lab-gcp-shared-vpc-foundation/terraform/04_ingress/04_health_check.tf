resource "google_compute_health_check" "http" {
  project = local.host_project_id
  name    = "hc-http"

  http_health_check {
    port         = 80
    request_path = "/"
  }
}
