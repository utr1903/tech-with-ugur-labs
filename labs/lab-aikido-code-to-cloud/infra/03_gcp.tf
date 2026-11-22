# GCP side of the demo: one dedicated project per environment, identical apart
# from names and the env label (see modules/gcp-env).
module "gcp" {
  source   = "./modules/gcp-env"
  for_each = toset(var.gcp_envs)

  env                = each.value
  org_id             = var.gcp_org_id
  billing_account    = var.gcp_billing_account
  region             = var.gcp_region
  zone               = var.gcp_zone
  own_customer_id    = var.gcp_own_customer_id
  aikido_customer_id = var.gcp_aikido_customer_id
  # Internal-only twin VM in prod, to compare how Aikido prioritises an exposed and an internal VM.
  internal_vm = each.value == "prod"
}
