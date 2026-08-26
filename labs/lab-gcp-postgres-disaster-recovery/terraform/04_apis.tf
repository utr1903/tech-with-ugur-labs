resource "google_project_service" "sqladmin" {
  service = "sqladmin.googleapis.com"

  disable_on_destroy = false
}
