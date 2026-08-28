resource "google_compute_instance" "vm" {
  for_each = local.vms

  project      = each.value.project
  name         = "vm-${each.key}"
  machine_type = "e2-micro"
  zone         = var.zone
  tags         = ["web"]

  boot_disk {
    initialize_params {
      image = "ubuntu-os-cloud/ubuntu-2404-lts-amd64"
    }
  }

  network_interface {
    subnetwork = each.value.subnetwork
    network_ip = each.value.ip
  }

  metadata = {
    ssh-keys       = "ubuntu:${trimspace(tls_private_key.ssh.public_key_openssh)} ubuntu"
    startup-script = local.startup_scripts[each.key]
  }
}

output "vm_name_a" {
  value = google_compute_instance.vm["service-a"].name
}

output "vm_name_b" {
  value = google_compute_instance.vm["service-b"].name
}

output "vm_zone" {
  value = var.zone
}
