output "project_id" {
  description = "ID of the demo project."
  value       = google_project.this.project_id
}

output "vm_ip" {
  description = "Public IP of the files-app VM."
  value       = google_compute_instance.vm["public"].network_interface[0].access_config[0].nat_ip
}

output "internal_vm_name" {
  description = "Name of the internal-only twin VM (null unless internal_vm)."
  value       = var.internal_vm ? google_compute_instance.vm["internal"].name : null
}

output "internal_vm_ip" {
  description = "Internal IP of the internal-only twin VM (null unless internal_vm)."
  value       = var.internal_vm ? google_compute_instance.vm["internal"].network_interface[0].network_ip : null
}

output "bucket" {
  description = "Name of the data bucket."
  value       = google_storage_bucket.data.name
}

output "registry" {
  description = "Docker registry path of the Artifact Registry repository."
  value       = local.registry
}

output "cspm_key" {
  description = "Base64 JSON key of the Aikido CSPM service account."
  value       = google_service_account_key.aikido_cspm.private_key
  sensitive   = true
}

output "registry_key" {
  description = "Base64 JSON key of the Aikido Artifact Registry service account."
  value       = google_service_account_key.aikido_registry.private_key
  sensitive   = true
}
