locals {
  server_sa    = "${var.lab_name}-server@${var.project_id}.iam.gserviceaccount.com"
  processor_sa = "${var.lab_name}-processor@${var.project_id}.iam.gserviceaccount.com"
  push_sa      = "${var.lab_name}-push@${var.project_id}.iam.gserviceaccount.com"
  bucket       = "${var.project_id}-${var.lab_name}-results"
  topic        = "projects/${var.project_id}/topics/${var.lab_name}"
}
