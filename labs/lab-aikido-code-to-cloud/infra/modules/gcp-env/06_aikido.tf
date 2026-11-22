# Aikido CSPM: read-only SA with a JSON key (registered via POST /clouds/gcp).

resource "google_service_account" "aikido_cspm" {
  project      = google_project.this.project_id
  account_id   = "aikido-cspm"
  display_name = "Aikido Security CSPM (${var.env})"

  depends_on = [google_project_service.this]
}

resource "google_project_iam_member" "aikido_cspm" {
  for_each = toset(["roles/viewer", "roles/iam.securityReviewer"])

  project = google_project.this.project_id
  role    = each.value
  member  = google_service_account.aikido_cspm.member
}

# INSECURE-BY-DESIGN: user-managed service account key for the Aikido CSPM SA
resource "google_service_account_key" "aikido_cspm" {
  service_account_id = google_service_account.aikido_cspm.name

  depends_on = [time_sleep.org_policy]
}

# Aikido container image scanning: Artifact Registry reader SA with a JSON key.

resource "google_service_account" "aikido_registry" {
  project      = google_project.this.project_id
  account_id   = "aikido-registry"
  display_name = "Aikido Security Artifact Registry scanner (${var.env})"

  depends_on = [google_project_service.this]
}

resource "google_project_iam_member" "aikido_registry" {
  project = google_project.this.project_id
  role    = "roles/artifactregistry.reader"
  member  = google_service_account.aikido_registry.member
}

# INSECURE-BY-DESIGN: user-managed service account key for the Aikido registry SA
resource "google_service_account_key" "aikido_registry" {
  service_account_id = google_service_account.aikido_registry.name

  depends_on = [time_sleep.org_policy]
}

# Aikido VM scanning: custom roles for Aikido's snapshot scanner SA (connected in the UI).

resource "google_project_iam_custom_role" "vm_scanner" {
  project     = google_project.this.project_id
  role_id     = "aikidoSecurityVmScannerRole"
  title       = "Aikido Security VM Scanner"
  description = "Lets Aikido snapshot VM disks for agentless VM scanning."
  permissions = [
    "compute.instances.list",
    "compute.instanceGroups.get",
    "compute.instanceGroups.list",
    "compute.disks.createSnapshot",
    "compute.disks.get",
    "compute.snapshots.create",
    "compute.snapshots.get",
    "compute.snapshots.list",
    "compute.snapshots.setLabels",
    "compute.snapshots.useReadOnly",
  ]

  depends_on = [google_project_service.this]
}

resource "google_project_iam_custom_role" "vm_scanner_snapshot_delete" {
  project     = google_project.this.project_id
  role_id     = "aikidoSecurityVmScannerSnapshotDeleteRole"
  title       = "Aikido Security VM Scanner Snapshot Delete"
  description = "Lets Aikido delete the disk snapshots it made in this project."
  permissions = ["compute.snapshots.delete"]

  depends_on = [google_project_service.this]
}

resource "google_project_iam_member" "vm_scanner" {
  project = google_project.this.project_id
  role    = google_project_iam_custom_role.vm_scanner.name
  member  = var.vm_scanner_member

  depends_on = [time_sleep.org_policy]
}

resource "google_project_iam_member" "vm_scanner_snapshot_delete" {
  project = google_project.this.project_id
  role    = google_project_iam_custom_role.vm_scanner_snapshot_delete.name
  member  = var.vm_scanner_member

  condition {
    title       = "AikidoSnapshotDeleteOnly"
    description = "Only Aikido-created snapshots (aik-snapshot-*)."
    expression  = "resource.type == \"compute.googleapis.com/Snapshot\" && resource.name.extract(\"/global/snapshots/{name}\").startsWith(\"aik-snapshot-\")"
  }

  depends_on = [time_sleep.org_policy]
}
