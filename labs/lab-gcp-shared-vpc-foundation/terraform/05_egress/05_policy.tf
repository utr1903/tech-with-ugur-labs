resource "google_network_security_gateway_security_policy" "swp" {
  project  = local.host_project_id
  name     = "swp-policy"
  location = var.region
}

resource "google_network_security_gateway_security_policy_rule" "allow" {
  for_each = { for i, domain in var.allowed_domains : domain => i }

  project                 = local.host_project_id
  location                = var.region
  gateway_security_policy = google_network_security_gateway_security_policy.swp.name
  name                    = "allow-${replace(each.key, ".", "-")}"
  priority                = 100 + each.value
  enabled                 = true
  session_matcher         = "host() == '${each.key}'"
  basic_profile           = "ALLOW"
}
