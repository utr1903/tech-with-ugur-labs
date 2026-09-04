locals {
  bucket_name   = "${var.resource_prefix}-${var.project_id}"
  data_store_id = "${var.resource_prefix}-datastore"
  engine_id     = "${var.resource_prefix}-app"
  sync_sa_id    = "${var.resource_prefix}-corpus-sync"
  sync_sa_email = "${local.sync_sa_id}@${var.project_id}.iam.gserviceaccount.com"

  # The CLI reads these; Terraform writes them so nothing is copied by hand.
  cli_env = <<-ENV
    GCP_PROJECT_ID=${var.project_id}
    GCP_LOCATION=${var.search_location}
    GCS_BUCKET=${local.bucket_name}
    DATA_STORE_ID=${local.data_store_id}
    ENGINE_ID=${local.engine_id}
    DRIVE_ID=${var.drive_id}
    SYNC_SERVICE_ACCOUNT=${local.sync_sa_email}
    LOG_LEVEL=info
  ENV
}
