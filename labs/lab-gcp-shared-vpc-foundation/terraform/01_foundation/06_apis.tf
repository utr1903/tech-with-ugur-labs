resource "google_project_service" "host" {
  for_each           = toset(local.host_apis)
  project            = google_project.host.project_id
  service            = each.value
  disable_on_destroy = false
}

resource "google_project_service" "service_a" {
  for_each           = toset(local.service_apis)
  project            = google_project.service_a.project_id
  service            = each.value
  disable_on_destroy = false
}

resource "google_project_service" "service_b" {
  for_each           = toset(local.service_apis)
  project            = google_project.service_b.project_id
  service            = each.value
  disable_on_destroy = false
}
