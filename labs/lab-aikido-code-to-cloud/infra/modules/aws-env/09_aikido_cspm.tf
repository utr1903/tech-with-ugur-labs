# Read-only role that Aikido's scanner assumes (with an external ID) to scan this account.
# This is NOT a planted flaw: it is the legitimate role from Aikido's install wizard
# (migrated from the former root aikido_terraform.tf), so it carries no demo marker.

resource "aws_iam_role" "aikido" {
  name = "${var.name_prefix}-security-readonly"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = {
        AWS = var.aikido_principal_arn
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

resource "aws_iam_role_policy_attachment" "aikido_security_audit" {
  role       = aws_iam_role.aikido.id
  policy_arn = "arn:${local.partition}:iam::aws:policy/SecurityAudit"
}

resource "aws_iam_role_policy" "aikido" {
  name = "aikido-security-policy"
  role = aws_iam_role.aikido.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "backup:ListBackupPlans",
          "backup:GetBackupPlan",
          "backup:ListProtectedResources",
          "batch:DescribeJobQueues",
          "budgets:ViewBudget",
          "ec2:GetSnapshotBlockPublicAccessState",
          "ec2:GetLaunchTemplateData",
          "ec2:GetEbsEncryptionByDefault",
          "eks:DescribeNodegroup",
          "eks:DescribeAddon",
          "eks:DescribeAddonConfiguration",
          "eks:DescribeIdentityProviderConfig",
          "eks:DescribePodIdentityAssociation",
          "lambda:GetFunction",
          "lambda:GetFunctionUrlConfig",
          "lambda:GetLayerVersion",
          "scheduler:GetSchedule",
          "scheduler:ListSchedules",
          "states:ListTagsForResource",
          "wafv2:GetRuleGroup",
        ]
        Resource = "*"
      },
      {
        Effect   = "Deny"
        Action   = ["rds:DownloadDBLogFilePortion"]
        Resource = "*"
      },
    ]
  })
}
