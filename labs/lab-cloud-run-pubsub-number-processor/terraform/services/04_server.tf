resource "google_cloud_run_v2_service" "server" {
  name                = "${var.lab_name}-server"
  location            = var.region
  deletion_protection = false
  ingress             = "INGRESS_TRAFFIC_ALL"
  template {
    service_account                  = local.server_sa
    max_instance_request_concurrency = 20
    timeout                          = "60s"
    scaling {
      min_instance_count = 0
      max_instance_count = 2
    }
    containers {
      image = var.server_image
      ports { container_port = 8080 }
      resources {
        limits   = { cpu = "1", memory = "512Mi" }
        cpu_idle = true
      }
      env {
        name  = "GOOGLE_CLOUD_PROJECT"
        value = var.project_id
      }
      env {
        name  = "PUBSUB_TOPIC"
        value = var.lab_name
      }
      startup_probe {
        http_get { path = "/healthz" }
      }
    }
  }
}
resource "google_cloud_run_v2_service_iam_member" "server_invoker" {
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.server.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}
output "server_url" { value = google_cloud_run_v2_service.server.uri }
