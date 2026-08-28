resource "google_compute_shared_vpc_host_project" "host" {
  project = local.host_project_id
}

resource "google_compute_shared_vpc_service_project" "service_a" {
  host_project    = google_compute_shared_vpc_host_project.host.project
  service_project = local.service_a_project_id
}

resource "google_compute_shared_vpc_service_project" "service_b" {
  host_project    = google_compute_shared_vpc_host_project.host.project
  service_project = local.service_b_project_id
}
