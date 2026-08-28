resource "google_compute_global_address" "lb" {
  project = local.host_project_id
  name    = "lb-ip"
}

resource "google_compute_target_http_proxy" "lb" {
  project = local.host_project_id
  name    = "lb-http-proxy"
  url_map = google_compute_url_map.lb.id
}

resource "google_compute_global_forwarding_rule" "lb" {
  project               = local.host_project_id
  name                  = "lb-forwarding-rule"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  ip_protocol           = "TCP"
  port_range            = "80"
  ip_address            = google_compute_global_address.lb.address
  target                = google_compute_target_http_proxy.lb.id
}

output "lb_ip" {
  value = google_compute_global_address.lb.address
}
