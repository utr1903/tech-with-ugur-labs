resource "tls_private_key" "swp" {
  algorithm = "RSA"
  rsa_bits  = 2048
}

resource "tls_self_signed_cert" "swp" {
  private_key_pem       = tls_private_key.swp.private_key_pem
  validity_period_hours = 720

  subject {
    common_name = "swp.lab.internal"
  }

  allowed_uses = ["key_encipherment", "digital_signature", "server_auth"]
}

resource "google_certificate_manager_certificate" "swp" {
  project  = local.host_project_id
  name     = "swp-cert"
  location = var.region

  self_managed {
    pem_certificate = tls_self_signed_cert.swp.cert_pem
    pem_private_key = tls_private_key.swp.private_key_pem
  }
}
