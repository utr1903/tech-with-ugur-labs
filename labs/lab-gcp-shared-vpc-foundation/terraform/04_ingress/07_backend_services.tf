resource "google_compute_backend_service" "vm" {
  for_each = local.services

  project               = local.host_project_id
  name                  = "be-${each.key}"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  protocol              = "HTTP"
  health_checks         = [google_compute_health_check.http.id]
  security_policy       = google_compute_security_policy.edge.self_link

  backend {
    group                 = google_compute_network_endpoint_group.vm[each.key].id
    balancing_mode        = "RATE"
    max_rate_per_endpoint = 100
  }
}
