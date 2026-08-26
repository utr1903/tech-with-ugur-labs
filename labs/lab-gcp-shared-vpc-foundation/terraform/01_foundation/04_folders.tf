resource "google_folder" "networking" {
  display_name        = "networking"
  parent              = "organizations/${var.org_id}"
  deletion_protection = false
}

resource "google_folder" "workloads" {
  display_name        = "workloads"
  parent              = "organizations/${var.org_id}"
  deletion_protection = false
}
