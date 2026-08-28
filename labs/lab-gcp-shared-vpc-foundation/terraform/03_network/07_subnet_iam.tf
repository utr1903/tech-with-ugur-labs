resource "google_compute_subnetwork_iam_member" "service_a_sa" {
  project    = local.host_project_id
  region     = var.region
  subnetwork = google_compute_subnetwork.service_a.name
  role       = "roles/compute.networkUser"
  member     = "serviceAccount:${local.service_a_sa_email}"
}

resource "google_compute_subnetwork_iam_member" "service_a_apis" {
  project    = local.host_project_id
  region     = var.region
  subnetwork = google_compute_subnetwork.service_a.name
  role       = "roles/compute.networkUser"
  member     = "serviceAccount:${local.service_a_number}@cloudservices.gserviceaccount.com"
}

resource "google_compute_subnetwork_iam_member" "service_b_sa" {
  project    = local.host_project_id
  region     = var.region
  subnetwork = google_compute_subnetwork.service_b.name
  role       = "roles/compute.networkUser"
  member     = "serviceAccount:${local.service_b_sa_email}"
}

resource "google_compute_subnetwork_iam_member" "service_b_apis" {
  project    = local.host_project_id
  region     = var.region
  subnetwork = google_compute_subnetwork.service_b.name
  role       = "roles/compute.networkUser"
  member     = "serviceAccount:${local.service_b_number}@cloudservices.gserviceaccount.com"
}
