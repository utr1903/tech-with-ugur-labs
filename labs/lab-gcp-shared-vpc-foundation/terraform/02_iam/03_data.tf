data "terraform_remote_state" "foundation" {
  backend = "local"

  config = {
    path = "${path.module}/../01_foundation/terraform.tfstate"
  }
}
