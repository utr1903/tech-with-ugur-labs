resource "google_compute_network" "this" {
  project                 = google_project.this.project_id
  name                    = local.name
  auto_create_subnetworks = false

  depends_on = [google_project_service.this]
}

resource "google_compute_subnetwork" "this" {
  project       = google_project.this.project_id
  name          = "${local.name}-${var.region}"
  region        = var.region
  network       = google_compute_network.this.id
  ip_cidr_range = "10.20.0.0/24"
}

resource "google_compute_firewall" "ingress" {
  project   = google_project.this.project_id
  name      = "${local.name}-ingress"
  network   = google_compute_network.this.id
  direction = "INGRESS"

  # INSECURE-BY-DESIGN: SSH (tcp 22) open to 0.0.0.0/0
  # INSECURE-BY-DESIGN: app port (tcp 8080) open to 0.0.0.0/0
  source_ranges = ["0.0.0.0/0"]
  target_tags   = ["files-app-public"]

  allow {
    protocol = "tcp"
    ports    = ["22", "8080"]
  }
}

# Internal twin VM: reachable from the subnet only, internet egress via Cloud NAT.

resource "google_compute_firewall" "ingress_internal" {
  count = var.internal_vm ? 1 : 0

  project       = google_project.this.project_id
  name          = "${local.name}-ingress-internal"
  network       = google_compute_network.this.id
  direction     = "INGRESS"
  source_ranges = [google_compute_subnetwork.this.ip_cidr_range]
  target_tags   = ["files-app-internal"]

  allow {
    protocol = "tcp"
    ports    = ["22", "8080"]
  }
}

resource "google_compute_router" "nat" {
  count = var.internal_vm ? 1 : 0

  project = google_project.this.project_id
  name    = "${local.name}-router"
  region  = var.region
  network = google_compute_network.this.id
}

resource "google_compute_router_nat" "this" {
  count = var.internal_vm ? 1 : 0

  project                            = google_project.this.project_id
  name                               = "${local.name}-nat"
  router                             = google_compute_router.nat[0].name
  region                             = var.region
  nat_ip_allocate_option             = "AUTO_ONLY"
  source_subnetwork_ip_ranges_to_nat = "LIST_OF_SUBNETWORKS"

  subnetwork {
    name                    = google_compute_subnetwork.this.id
    source_ip_ranges_to_nat = ["ALL_IP_RANGES"]
  }
}
