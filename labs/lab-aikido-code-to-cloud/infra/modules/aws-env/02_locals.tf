locals {
  account_id = data.aws_caller_identity.current.account_id
  partition  = data.aws_partition.current.partition

  cluster_name        = "${var.name_prefix}-eks"
  bucket_name         = "${var.name_prefix}-data-${local.account_id}"
  ecr_repository_name = "${var.name_prefix}/chatbot-server"

  azs = slice(data.aws_availability_zones.available.names, 0, 2)
}
