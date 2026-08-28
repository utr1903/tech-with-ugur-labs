resource "google_network_services_gateway" "swp" {
  project  = local.host_project_id
  name     = "swp"
  location = var.region
  type     = "SECURE_WEB_GATEWAY"

  addresses                            = [local.swp_ip]
  ports                                = [443]
  scope                                = "swp-lab"
  certificate_urls                     = [google_certificate_manager_certificate.swp.id]
  gateway_security_policy              = google_network_security_gateway_security_policy.swp.id
  network                              = local.network_id
  subnetwork                           = local.subnet_host_id
  delete_swg_autogen_router_on_destroy = true
}
