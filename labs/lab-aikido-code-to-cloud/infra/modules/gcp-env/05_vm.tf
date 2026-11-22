resource "google_service_account" "vm" {
  project      = google_project.this.project_id
  account_id   = "vm-app"
  display_name = "files-app VM (${var.env})"

  depends_on = [google_project_service.this]
}

resource "google_project_iam_member" "vm_editor" {
  project = google_project.this.project_id
  # INSECURE-BY-DESIGN: VM service account has the primitive Editor role on the project
  role   = "roles/editor"
  member = google_service_account.vm.member
}

# The public files-app VM, plus (when var.internal_vm) a twin that is identical
# apart from its name, its network tag and the missing external IP.
locals {
  vms = merge(
    { public = { name = "${local.name}-files-app", tag = "files-app-public", public_ip = true } },
    var.internal_vm ? { internal = { name = "${local.name}-files-app-internal", tag = "files-app-internal", public_ip = false } } : {},
  )
}

resource "google_compute_instance" "vm" {
  for_each = local.vms

  project      = google_project.this.project_id
  name         = each.value.name
  zone         = var.zone
  machine_type = "e2-small"
  tags         = [each.value.tag]

  boot_disk {
    initialize_params {
      image = var.vm_image
    }
  }

  network_interface {
    subnetwork = google_compute_subnetwork.this.id

    # INSECURE-BY-DESIGN: VM has a public IP address
    dynamic "access_config" {
      for_each = each.value.public_ip ? [1] : []
      content {}
    }
  }

  service_account {
    email = google_service_account.vm.email
    # INSECURE-BY-DESIGN: VM uses the full cloud-platform access scope
    scopes = ["cloud-platform"]
  }

  # INSECURE-BY-DESIGN: Shielded VM (secure boot, vTPM, integrity monitoring) disabled
  shielded_instance_config {
    enable_secure_boot          = false
    enable_vtpm                 = false
    enable_integrity_monitoring = false
  }

  metadata = {
    # INSECURE-BY-DESIGN: OS Login disabled
    enable-oslogin = "FALSE"
    # INSECURE-BY-DESIGN: serial port access enabled
    serial-port-enable = "TRUE"
  }

  metadata_startup_script = templatefile("${path.module}/startup.sh.tftpl", {
    registry = local.registry
    bucket   = google_storage_bucket.data.name
    env      = var.env
  })

  depends_on = [google_project_iam_member.vm_editor]
}
