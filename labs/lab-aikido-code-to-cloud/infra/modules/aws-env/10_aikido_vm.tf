# Role that Aikido's EBS scanner assumes (with an external ID) to snapshot and read instance
# volumes for VM scanning. This is NOT a planted flaw: it is the legitimate role from Aikido's
# install wizard (its CloudFormation template translated to Terraform), so it carries no demo marker.

resource "aws_iam_policy" "aikido_vm" {
  name        = "${var.name_prefix}-vm-scanner"
  description = "Aikido Security EBS snapshot management role"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "ec2:DescribeInstances",
          "ec2:DescribeVolumes",
          "ec2:DescribeVolumeStatus",
          "ec2:DescribeSnapshots",
          "ec2:CreateSnapshot",
          "ec2:CreateTags",
          "ebs:ListSnapshotBlocks",
          "ebs:GetSnapshotBlock",
          "kms:DescribeKey",
          "kms:Decrypt",
          "kms:GenerateDataKey",
        ]
        Resource = "*"
      },
      {
        # Aikido may only delete the snapshots it created and tagged itself.
        Effect   = "Allow"
        Action   = ["ec2:DeleteSnapshot"]
        Resource = "*"
        Condition = {
          StringEquals = {
            "aws:ResourceTag/aikido_snapshot" = "true"
          }
        }
      },
    ]
  })
}

resource "aws_iam_role" "aikido_vm" {
  name = "${var.name_prefix}-vm-scanner"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = {
        AWS = var.aikido_vm_principal_arn
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

resource "aws_iam_role_policy_attachment" "aikido_vm" {
  role       = aws_iam_role.aikido_vm.name
  policy_arn = aws_iam_policy.aikido_vm.arn
}
