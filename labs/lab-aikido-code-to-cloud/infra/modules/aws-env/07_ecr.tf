resource "aws_ecr_repository" "server" {
  name         = local.ecr_repository_name
  force_delete = true

  # INSECURE-BY-DESIGN: mutable image tags
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    # INSECURE-BY-DESIGN: scan on push disabled
    scan_on_push = false
  }
}
