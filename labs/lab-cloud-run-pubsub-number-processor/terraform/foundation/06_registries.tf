resource "google_artifact_registry_repository" "images" {
  for_each        = toset(["server", "processor"])
  location        = var.region
  repository_id   = "${var.lab_name}-${each.value}"
  format          = "DOCKER"
  deletion_policy = "DELETE"
  depends_on      = [google_project_service.apis]
}
