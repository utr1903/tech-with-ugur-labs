resource "google_compute_firewall" "allow_egress_to_swp" {
  project   = local.host_project_id
  name      = "allow-egress-to-swp"
  network   = data.terraform_remote_state.network.outputs.network_id
  direction = "EGRESS"
  priority  = 1000

  allow {
    protocol = "tcp"
    ports    = ["443"]
  }

  destination_ranges = ["${local.swp_ip}/32"]
  target_tags        = ["web"]
}
