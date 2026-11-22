variables {
  aikido_external_id  = "aikido-123456"
  gcp_org_id          = "123456789012"
  gcp_billing_account = "000000-AAAAAA-000000"
  gcp_own_customer_id = "C00000000"
}

run "aikido_role" {
  command = plan

  module {
    source = "./modules/aws-env"
  }

  assert {
    condition     = aws_iam_role.aikido.name == "aikido-demo-security-readonly"
    error_message = "role name"
  }
  assert {
    condition = (
      jsondecode(aws_iam_role.aikido.assume_role_policy).Statement[0].Principal.AWS == "arn:aws:iam::881830977366:role/service-role/lambda-aws-cloud-findings-role-uox26vzd" &&
      jsondecode(aws_iam_role.aikido.assume_role_policy).Statement[0].Action == "sts:AssumeRole" &&
      jsondecode(aws_iam_role.aikido.assume_role_policy).Statement[0].Condition.StringEquals["sts:ExternalId"] == "aikido-123456"
    )
    error_message = "trust policy must match the Aikido wizard (principal + external id)"
  }
  assert {
    condition     = endswith(aws_iam_role_policy_attachment.aikido_security_audit.policy_arn, ":iam::aws:policy/SecurityAudit")
    error_message = "SecurityAudit must be attached"
  }
  assert {
    condition = toset(one([for s in jsondecode(aws_iam_role_policy.aikido.policy).Statement : s.Action if s.Effect == "Allow"])) == toset([
      "backup:ListBackupPlans", "backup:GetBackupPlan", "backup:ListProtectedResources",
      "batch:DescribeJobQueues", "budgets:ViewBudget",
      "ec2:GetSnapshotBlockPublicAccessState", "ec2:GetLaunchTemplateData", "ec2:GetEbsEncryptionByDefault",
      "eks:DescribeNodegroup", "eks:DescribeAddon", "eks:DescribeAddonConfiguration",
      "eks:DescribeIdentityProviderConfig", "eks:DescribePodIdentityAssociation",
      "lambda:GetFunction", "lambda:GetFunctionUrlConfig", "lambda:GetLayerVersion",
      "scheduler:GetSchedule", "scheduler:ListSchedules",
      "states:ListTagsForResource", "wafv2:GetRuleGroup",
    ])
    error_message = "Allow actions must equal the wizard's list exactly"
  }
  assert {
    condition     = toset(one([for s in jsondecode(aws_iam_role_policy.aikido.policy).Statement : s.Action if s.Effect == "Deny"])) == toset(["rds:DownloadDBLogFilePortion"])
    error_message = "Deny statement must match the wizard"
  }
}

run "custom_prefix" {
  command = plan

  module {
    source = "./modules/aws-env"
  }

  variables {
    name_prefix = "zz-demo"
  }

  assert {
    condition = (
      aws_eks_cluster.this.name == "zz-demo-eks" &&
      aws_iam_role.cluster.name == "zz-demo-eks-cluster" &&
      aws_iam_role.node.name == "zz-demo-eks-node" &&
      aws_eks_node_group.this.node_group_name == "zz-demo-nodes" &&
      aws_iam_role.app.name == "zz-demo-chatbot-server" &&
      aws_iam_role.aikido.name == "zz-demo-security-readonly" &&
      aws_iam_role.aikido_vm.name == "zz-demo-vm-scanner" &&
      aws_iam_policy.aikido_vm.name == "zz-demo-vm-scanner" &&
      aws_iam_role.aikido_ecr.name == "zz-demo-ecr-readonly" &&
      aws_ecr_repository.server.name == "zz-demo/chatbot-server" &&
      startswith(aws_s3_bucket.data.bucket, "zz-demo-data-") &&
      aws_eks_pod_identity_association.app.cluster_name == "zz-demo-eks" &&
      aws_subnet.public[0].tags["kubernetes.io/cluster/zz-demo-eks"] == "shared"
    )
    error_message = "a resource name ignores var.name_prefix"
  }
}

run "aikido_vm_role" {
  command = plan

  module {
    source = "./modules/aws-env"
  }

  assert {
    condition     = aws_iam_role.aikido_vm.name == "aikido-demo-vm-scanner" && aws_iam_policy.aikido_vm.name == "aikido-demo-vm-scanner"
    error_message = "VM role and policy names"
  }
  assert {
    condition = (
      jsondecode(aws_iam_role.aikido_vm.assume_role_policy).Statement[0].Principal.AWS == "arn:aws:iam::881830977366:role/aws-ebs-scanner-role" &&
      jsondecode(aws_iam_role.aikido_vm.assume_role_policy).Statement[0].Action == "sts:AssumeRole" &&
      jsondecode(aws_iam_role.aikido_vm.assume_role_policy).Statement[0].Condition.StringEquals["sts:ExternalId"] == "aikido-123456"
    )
    error_message = "VM trust policy must match the Aikido wizard (principal + external id)"
  }
  assert {
    condition = toset(one([for s in jsondecode(aws_iam_policy.aikido_vm.policy).Statement : s.Action if !can(s.Condition)])) == toset([
      "ec2:DescribeInstances", "ec2:DescribeVolumes", "ec2:DescribeVolumeStatus", "ec2:DescribeSnapshots",
      "ec2:CreateSnapshot", "ec2:CreateTags", "ebs:ListSnapshotBlocks", "ebs:GetSnapshotBlock",
      "kms:DescribeKey", "kms:Decrypt", "kms:GenerateDataKey",
    ])
    error_message = "VM unconditional actions must equal the wizard's list exactly"
  }
  assert {
    condition = (
      one([for s in jsondecode(aws_iam_policy.aikido_vm.policy).Statement : s.Action if can(s.Condition)]) == ["ec2:DeleteSnapshot"] &&
      one([for s in jsondecode(aws_iam_policy.aikido_vm.policy).Statement : s.Condition if can(s.Condition)]).StringEquals["aws:ResourceTag/aikido_snapshot"] == "true"
    )
    error_message = "ec2:DeleteSnapshot must be limited to aikido_snapshot=true snapshots"
  }
  assert {
    condition     = aws_iam_role_policy_attachment.aikido_vm.role == "aikido-demo-vm-scanner"
    error_message = "VM policy must be attached to the VM role"
  }
}

run "aikido_ecr_role" {
  command = plan

  module {
    source = "./modules/aws-env"
  }

  assert {
    condition     = aws_iam_role.aikido_ecr.name == "aikido-demo-ecr-readonly"
    error_message = "ECR role name"
  }
  assert {
    condition = (
      jsondecode(aws_iam_role.aikido_ecr.assume_role_policy).Statement[0].Principal.AWS == "arn:aws:iam::881830977366:role/service-role/lambda-container-image-scanner-role-pb0qotst" &&
      jsondecode(aws_iam_role.aikido_ecr.assume_role_policy).Statement[0].Action == "sts:AssumeRole" &&
      jsondecode(aws_iam_role.aikido_ecr.assume_role_policy).Statement[0].Condition.StringEquals["sts:ExternalId"] == "aikido-123456"
    )
    error_message = "ECR trust policy must match the Aikido wizard (principal + external id)"
  }
  assert {
    condition = toset(one(jsondecode(aws_iam_role_policy.aikido_ecr.policy).Statement).Action) == toset([
      "ecr:GetDownloadUrlForLayer", "ecr:BatchGetImage", "ecr:BatchCheckLayerAvailability",
      "ecr:ListImages", "ecr:DescribeImages", "ecr:DescribeRepositories", "ecr:DescribeRegistry",
      "ecr:GetAuthorizationToken", "ecr:ListTagsForResource",
    ])
    error_message = "ECR actions must equal the wizard's list exactly"
  }
}
