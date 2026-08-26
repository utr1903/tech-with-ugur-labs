locals {
  host_project_id      = data.terraform_remote_state.foundation.outputs.host_project_id
  service_a_project_id = data.terraform_remote_state.foundation.outputs.service_a_project_id
  service_b_project_id = data.terraform_remote_state.foundation.outputs.service_b_project_id
  service_a_number     = data.terraform_remote_state.foundation.outputs.service_a_project_number
  service_b_number     = data.terraform_remote_state.foundation.outputs.service_b_project_number
  service_a_sa_email   = data.terraform_remote_state.iam.outputs.service_a_sa_email
  service_b_sa_email   = data.terraform_remote_state.iam.outputs.service_b_sa_email

  cidr_host       = "10.10.0.0/24"
  cidr_service_a  = "10.10.1.0/24"
  cidr_service_b  = "10.10.2.0/24"
  cidr_proxy_only = "10.10.4.0/23"
}
