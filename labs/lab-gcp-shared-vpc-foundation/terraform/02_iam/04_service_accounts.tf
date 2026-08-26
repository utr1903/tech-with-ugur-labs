resource "google_service_account" "host" {
  project      = local.host_project_id
  account_id   = "sa-host"
  display_name = "Host network authority"
}

resource "google_service_account" "service_a" {
  project      = local.service_a_project_id
  account_id   = "sa-service-a"
  display_name = "Service project A workload admin"
}

resource "google_service_account" "service_b" {
  project      = local.service_b_project_id
  account_id   = "sa-service-b"
  display_name = "Service project B workload admin"
}

output "host_sa_email" {
  value = google_service_account.host.email
}

output "service_a_sa_email" {
  value = google_service_account.service_a.email
}

output "service_b_sa_email" {
  value = google_service_account.service_b.email
}
