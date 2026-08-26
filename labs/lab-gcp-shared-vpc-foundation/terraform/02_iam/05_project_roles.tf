resource "google_project_iam_member" "host" {
  for_each = toset(local.host_roles)
  project  = local.host_project_id
  role     = each.value
  member   = "serviceAccount:${google_service_account.host.email}"
}

resource "google_project_iam_member" "service_a" {
  for_each = toset(local.service_roles)
  project  = local.service_a_project_id
  role     = each.value
  member   = "serviceAccount:${google_service_account.service_a.email}"
}

resource "google_project_iam_member" "service_b" {
  for_each = toset(local.service_roles)
  project  = local.service_b_project_id
  role     = each.value
  member   = "serviceAccount:${google_service_account.service_b.email}"
}
