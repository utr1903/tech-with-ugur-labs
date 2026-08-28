data "terraform_remote_state" "foundation" {
  backend = "local"

  config = {
    path = "${path.module}/../01_foundation/terraform.tfstate"
  }
}

data "terraform_remote_state" "network" {
  backend = "local"

  config = {
    path = "${path.module}/../03_network/terraform.tfstate"
  }
}
