resource "random_id" "suffix" {
  byte_length = 3
}

resource "google_project" "host" {
  project_id          = "svpc-host-${random_id.suffix.hex}"
  name                = "svpc-host"
  folder_id           = google_folder.networking.name
  billing_account     = var.billing_account
  auto_create_network = false
  deletion_policy     = "DELETE"
}

resource "google_project" "service_a" {
  project_id          = "svpc-service-a-${random_id.suffix.hex}"
  name                = "svpc-service-a"
  folder_id           = google_folder.workloads.name
  billing_account     = var.billing_account
  auto_create_network = false
  deletion_policy     = "DELETE"
}

resource "google_project" "service_b" {
  project_id          = "svpc-service-b-${random_id.suffix.hex}"
  name                = "svpc-service-b"
  folder_id           = google_folder.workloads.name
  billing_account     = var.billing_account
  auto_create_network = false
  deletion_policy     = "DELETE"
}

output "host_project_id" {
  value = google_project.host.project_id
}

output "service_a_project_id" {
  value = google_project.service_a.project_id
}

output "service_b_project_id" {
  value = google_project.service_b.project_id
}

output "service_a_project_number" {
  value = google_project.service_a.number
}

output "service_b_project_number" {
  value = google_project.service_b.number
}
