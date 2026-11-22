variables {
  aikido_external_id  = "aikido-123456"
  gcp_org_id          = "123456789012"
  gcp_billing_account = "000000-AAAAAA-000000"
  gcp_own_customer_id = "C00000000"
}

run "eks" {
  command = plan

  module {
    source = "./modules/aws-env"
  }

  assert {
    condition     = aws_eks_cluster.this.name == "aikido-demo-eks" && aws_eks_cluster.this.version == "1.37"
    error_message = "cluster name/version"
  }
  assert {
    condition     = aws_eks_cluster.this.vpc_config[0].endpoint_public_access && aws_eks_cluster.this.vpc_config[0].public_access_cidrs == toset(["0.0.0.0/0"])
    error_message = "public endpoint open to the world"
  }
  assert {
    condition     = length(aws_eks_cluster.this.encryption_config) == 0
    error_message = "no secrets envelope encryption"
  }
  assert {
    condition     = try(length(aws_eks_cluster.this.enabled_cluster_log_types), 0) == 0
    error_message = "control-plane logging disabled"
  }
  assert {
    condition     = aws_eks_cluster.this.access_config[0].authentication_mode == "API_AND_CONFIG_MAP" && aws_eks_cluster.this.access_config[0].bootstrap_cluster_creator_admin_permissions == false
    error_message = "access config"
  }
  assert {
    condition     = aws_eks_access_entry.deployer.principal_arn == data.aws_iam_session_context.current.issuer_arn
    error_message = "access entry must use the issuer (role/user) ARN, not the STS session ARN"
  }
  assert {
    condition     = endswith(aws_eks_access_policy_association.deployer.policy_arn, ":eks::aws:cluster-access-policy/AmazonEKSClusterAdminPolicy") && aws_eks_access_policy_association.deployer.access_scope[0].type == "cluster"
    error_message = "deployer must be cluster admin at cluster scope"
  }
  assert {
    condition     = aws_eks_node_group.this.scaling_config[0].desired_size == 2 && aws_eks_node_group.this.scaling_config[0].min_size == 2 && aws_eks_node_group.this.scaling_config[0].max_size == 2
    error_message = "node group fixed at var.node_count"
  }
  assert {
    condition     = aws_eks_node_group.this.instance_types == tolist(["t3.medium"]) && aws_eks_node_group.this.ami_type == "AL2023_x86_64_STANDARD"
    error_message = "node instance type / AMI type"
  }
  assert {
    condition     = toset(keys(aws_eks_addon.pre_node)) == toset(["vpc-cni", "kube-proxy", "eks-pod-identity-agent"]) && aws_eks_addon.coredns.addon_name == "coredns"
    error_message = "the four add-ons"
  }
  assert {
    condition     = toset([for a in aws_iam_role_policy_attachment.node : element(split("/", a.policy_arn), 1)]) == toset(["AmazonEKSWorkerNodePolicy", "AmazonEKS_CNI_Policy", "AmazonEC2ContainerRegistryReadOnly"])
    error_message = "node role managed policies"
  }
}

# The default run cannot tell the issuer ARN from the caller ARN when the caller is an IAM user,
# so simulate an assumed-role session and pin the access entry to the role ARN.
run "assumed_role_caller" {
  command = plan

  module {
    source = "./modules/aws-env"
  }

  override_data {
    target = data.aws_caller_identity.current
    values = {
      account_id = "123456789012"
      arn        = "arn:aws:sts::123456789012:assumed-role/Deployer/session"
      user_id    = "AROAEXAMPLEEXAMPLE:session"
    }
  }

  override_data {
    target = data.aws_iam_session_context.current
    values = {
      issuer_arn = "arn:aws:iam::123456789012:role/Deployer"
    }
  }

  assert {
    condition     = aws_eks_access_entry.deployer.principal_arn == "arn:aws:iam::123456789012:role/Deployer"
    error_message = "access entry must use the role ARN, not the STS session ARN"
  }
}
