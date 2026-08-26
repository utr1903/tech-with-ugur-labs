locals {
  host_project_id = data.terraform_remote_state.foundation.outputs.host_project_id

  services = {
    "service-a" = { vm_ip = data.terraform_remote_state.network.outputs.vm_ip_a }
    "service-b" = { vm_ip = data.terraform_remote_state.network.outputs.vm_ip_b }
  }
}
