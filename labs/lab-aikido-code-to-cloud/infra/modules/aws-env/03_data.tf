data "aws_availability_zones" "available" {
  state = "available"

  filter {
    name   = "opt-in-status"
    values = ["opt-in-not-required"]
  }
}

data "aws_caller_identity" "current" {}

data "aws_partition" "current" {}

data "aws_region" "current" {}

# Resolves the assumed-role session ARN to the underlying role ARN (used by the EKS access entry).
data "aws_iam_session_context" "current" {
  arn = data.aws_caller_identity.current.arn
}
