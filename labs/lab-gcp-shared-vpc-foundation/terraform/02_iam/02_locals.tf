locals {
  host_project_id      = data.terraform_remote_state.foundation.outputs.host_project_id
  service_a_project_id = data.terraform_remote_state.foundation.outputs.service_a_project_id
  service_b_project_id = data.terraform_remote_state.foundation.outputs.service_b_project_id

  host_roles    = ["roles/compute.networkAdmin", "roles/compute.securityAdmin"]
  service_roles = ["roles/compute.instanceAdmin.v1", "roles/iam.serviceAccountUser"]
}
