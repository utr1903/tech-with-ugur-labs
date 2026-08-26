resource "google_compute_subnetwork" "host" {
  project       = local.host_project_id
  name          = "snet-host"
  region        = var.region
  network       = google_compute_network.svpc.id
  ip_cidr_range = local.cidr_host
}

resource "google_compute_subnetwork" "service_a" {
  project       = local.host_project_id
  name          = "snet-service-a"
  region        = var.region
  network       = google_compute_network.svpc.id
  ip_cidr_range = local.cidr_service_a
}

resource "google_compute_subnetwork" "service_b" {
  project       = local.host_project_id
  name          = "snet-service-b"
  region        = var.region
  network       = google_compute_network.svpc.id
  ip_cidr_range = local.cidr_service_b
}

resource "google_compute_subnetwork" "proxy_only" {
  project       = local.host_project_id
  name          = "snet-proxy-only"
  region        = var.region
  network       = google_compute_network.svpc.id
  ip_cidr_range = local.cidr_proxy_only
  purpose       = "REGIONAL_MANAGED_PROXY"
  role          = "ACTIVE"
}

output "subnet_host_id" {
  value = google_compute_subnetwork.host.id
}

output "subnet_service_a_self_link" {
  value = google_compute_subnetwork.service_a.self_link
}

output "subnet_service_b_self_link" {
  value = google_compute_subnetwork.service_b.self_link
}

output "vm_ip_a" {
  value = cidrhost(local.cidr_service_a, 10)
}

output "vm_ip_b" {
  value = cidrhost(local.cidr_service_b, 10)
}

output "swp_ip" {
  value = cidrhost(local.cidr_host, 10)
}
