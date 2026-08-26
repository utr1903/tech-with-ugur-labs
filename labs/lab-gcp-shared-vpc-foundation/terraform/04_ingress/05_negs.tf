resource "google_compute_network_endpoint_group" "vm" {
  for_each = local.services

  project               = local.host_project_id
  name                  = "neg-${each.key}"
  zone                  = var.zone
  network               = data.terraform_remote_state.network.outputs.network_self_link
  network_endpoint_type = "NON_GCP_PRIVATE_IP_PORT"
  default_port          = 80
}

resource "google_compute_network_endpoint" "vm" {
  for_each = local.services

  project                = local.host_project_id
  zone                   = var.zone
  network_endpoint_group = google_compute_network_endpoint_group.vm[each.key].name
  ip_address             = each.value.vm_ip
  port                   = 80
}
