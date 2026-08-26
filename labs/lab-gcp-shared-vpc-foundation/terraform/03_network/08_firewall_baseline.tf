resource "google_compute_firewall" "deny_all_ingress" {
  project   = local.host_project_id
  name      = "deny-all-ingress"
  network   = google_compute_network.svpc.id
  direction = "INGRESS"
  priority  = 65534

  deny {
    protocol = "all"
  }

  source_ranges = ["0.0.0.0/0"]
}

resource "google_compute_firewall" "deny_all_egress" {
  project   = local.host_project_id
  name      = "deny-all-egress"
  network   = google_compute_network.svpc.id
  direction = "EGRESS"
  priority  = 65534

  deny {
    protocol = "all"
  }

  destination_ranges = ["0.0.0.0/0"]
}
