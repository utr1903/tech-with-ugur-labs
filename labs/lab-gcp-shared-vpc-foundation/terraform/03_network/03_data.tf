data "terraform_remote_state" "foundation" {
  backend = "local"

  config = {
    path = "${path.module}/../01_foundation/terraform.tfstate"
  }
}

data "terraform_remote_state" "iam" {
  backend = "local"

  config = {
    path = "${path.module}/../02_iam/terraform.tfstate"
  }
}
