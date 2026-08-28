resource "google_compute_firewall" "allow_gfe_health_checks" {
  project   = local.host_project_id
  name      = "allow-gfe-health-checks"
  network   = data.terraform_remote_state.network.outputs.network_self_link
  direction = "INGRESS"
  priority  = 1000

  allow {
    protocol = "tcp"
    ports    = ["80"]
  }

  source_ranges = ["130.211.0.0/22", "35.191.0.0/16"]
  target_tags   = ["web"]
}

resource "google_compute_firewall" "allow_iap_ssh" {
  project   = local.host_project_id
  name      = "allow-iap-ssh"
  network   = data.terraform_remote_state.network.outputs.network_self_link
  direction = "INGRESS"
  priority  = 1000

  allow {
    protocol = "tcp"
    ports    = ["22"]
  }

  source_ranges = ["35.235.240.0/20"]
  target_tags   = ["web"]
}
