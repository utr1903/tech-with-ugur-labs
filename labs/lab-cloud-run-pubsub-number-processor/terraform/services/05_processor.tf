resource "google_cloud_run_v2_service" "processor" {
  name                = "${var.lab_name}-processor"
  location            = var.region
  deletion_protection = false
  ingress             = "INGRESS_TRAFFIC_ALL"
  template {
    service_account                  = local.processor_sa
    max_instance_request_concurrency = 20
    timeout                          = "60s"
    scaling {
      min_instance_count = 0
      max_instance_count = 2
    }
    containers {
      image = var.processor_image
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
        name  = "BUCKET_NAME"
        value = local.bucket
      }
      startup_probe {
        http_get { path = "/healthz" }
      }
    }
  }
}
resource "google_cloud_run_v2_service_iam_member" "processor_invoker" {
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.processor.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${local.push_sa}"
}
output "processor_url" { value = google_cloud_run_v2_service.processor.uri }
