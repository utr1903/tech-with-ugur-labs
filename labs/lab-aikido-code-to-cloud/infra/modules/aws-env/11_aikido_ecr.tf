# Read-only role that Aikido's container image scanner assumes (with an external ID) to pull and
# scan ECR images. This is NOT a planted flaw: it is the legitimate role from Aikido's install
# wizard (migrated from the former root aikido_aws-ecr_terraform.tf), so it carries no demo marker.

resource "aws_iam_role" "aikido_ecr" {
  name = "${var.name_prefix}-ecr-readonly"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = {
        AWS = var.aikido_ecr_principal_arn
      }
      Action = "sts:AssumeRole"
      Condition = {
        StringEquals = {
          "sts:ExternalId" = var.aikido_external_id
        }
      }
    }]
  })
}

resource "aws_iam_role_policy" "aikido_ecr" {
  name = "aikido-security-ecr-policy"
  role = aws_iam_role.aikido_ecr.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "ecr:GetDownloadUrlForLayer",
        "ecr:BatchGetImage",
        "ecr:BatchCheckLayerAvailability",
        "ecr:ListImages",
        "ecr:DescribeImages",
        "ecr:DescribeRepositories",
        "ecr:DescribeRegistry",
        "ecr:GetAuthorizationToken",
        "ecr:ListTagsForResource",
      ]
      Resource = "*"
    }]
  })
}
