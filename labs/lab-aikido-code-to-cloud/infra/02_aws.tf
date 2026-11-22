# AWS side of the demo: EKS, VPC, S3, ECR and the Aikido integration roles
# (see modules/aws-env).
module "aws" {
  source = "./modules/aws-env"

  region                   = var.region
  name_prefix              = var.name_prefix
  vpc_cidr                 = var.vpc_cidr
  kubernetes_version       = var.kubernetes_version
  node_instance_type       = var.node_instance_type
  node_count               = var.node_count
  app_namespace            = var.app_namespace
  app_service_account      = var.app_service_account
  aikido_principal_arn     = var.aikido_principal_arn
  aikido_vm_principal_arn  = var.aikido_vm_principal_arn
  aikido_ecr_principal_arn = var.aikido_ecr_principal_arn
  aikido_external_id       = var.aikido_external_id
}
