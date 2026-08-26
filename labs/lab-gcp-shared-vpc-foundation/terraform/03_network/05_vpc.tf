resource "google_compute_network" "svpc" {
  project                 = local.host_project_id
  name                    = "svpc"
  auto_create_subnetworks = false

  depends_on = [google_compute_shared_vpc_host_project.host]
}

output "network_self_link" {
  value = google_compute_network.svpc.self_link
}

output "network_id" {
  value = google_compute_network.svpc.id
}
