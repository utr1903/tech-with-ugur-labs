output "server_url" { value = google_cloud_run_v2_service.server.uri }

output "processor_url" { value = google_cloud_run_v2_service.processor.uri }
