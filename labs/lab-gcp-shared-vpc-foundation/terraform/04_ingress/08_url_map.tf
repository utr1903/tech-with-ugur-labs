resource "google_compute_url_map" "lb" {
  project         = local.host_project_id
  name            = "lb-shared-vpc-lab"
  default_service = google_compute_backend_service.vm["service-a"].id

  host_rule {
    hosts        = ["*"]
    path_matcher = "routes"
  }

  path_matcher {
    name            = "routes"
    default_service = google_compute_backend_service.vm["service-a"].id

    path_rule {
      paths   = ["/a", "/a/*"]
      service = google_compute_backend_service.vm["service-a"].id

      route_action {
        url_rewrite {
          path_prefix_rewrite = "/"
        }
      }
    }

    path_rule {
      paths   = ["/b", "/b/*"]
      service = google_compute_backend_service.vm["service-b"].id

      route_action {
        url_rewrite {
          path_prefix_rewrite = "/"
        }
      }
    }
  }
}
