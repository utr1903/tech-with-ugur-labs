resource "google_compute_security_policy" "edge" {
  project = local.host_project_id
  name    = "edge-allowlist"

  rule {
    action      = "deny(403)"
    priority    = 2147483647
    description = "Default rule: deny everything the host has not allowed."

    match {
      versioned_expr = "SRC_IPS_V1"

      config {
        src_ip_ranges = ["*"]
      }
    }
  }

  dynamic "rule" {
    for_each = { for i, cidr in var.allowlist_cidrs : i => cidr }

    content {
      action      = "allow"
      priority    = 1000 + tonumber(rule.key)
      description = "Host-approved caller."

      match {
        versioned_expr = "SRC_IPS_V1"

        config {
          src_ip_ranges = [rule.value]
        }
      }
    }
  }
}
