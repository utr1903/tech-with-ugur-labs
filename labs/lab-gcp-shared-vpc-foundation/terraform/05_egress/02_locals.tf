locals {
  host_project_id = data.terraform_remote_state.foundation.outputs.host_project_id
  network_id      = data.terraform_remote_state.network.outputs.network_id
  subnet_host_id  = data.terraform_remote_state.network.outputs.subnet_host_id
  swp_ip          = data.terraform_remote_state.network.outputs.swp_ip
}
