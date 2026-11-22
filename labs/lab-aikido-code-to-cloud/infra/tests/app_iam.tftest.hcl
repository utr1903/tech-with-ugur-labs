variables {
  aikido_external_id  = "aikido-123456"
  gcp_org_id          = "123456789012"
  gcp_billing_account = "000000-AAAAAA-000000"
  gcp_own_customer_id = "C00000000"
}

run "app_iam" {
  command = plan

  module {
    source = "./modules/aws-env"
  }

  assert {
    condition     = aws_iam_role.app.name == "aikido-demo-chatbot-server"
    error_message = "app role name"
  }
  assert {
    condition = (
      jsondecode(aws_iam_role.app.assume_role_policy).Statement[0].Principal.Service == "pods.eks.amazonaws.com" &&
      toset(jsondecode(aws_iam_role.app.assume_role_policy).Statement[0].Action) == toset(["sts:AssumeRole", "sts:TagSession"])
    )
    error_message = "trust policy must be the EKS Pod Identity principal with AssumeRole + TagSession"
  }
  assert {
    condition     = toset([for s in jsondecode(aws_iam_role_policy.app.policy).Statement : "${s.Effect} ${s.Action} ${s.Resource}"]) == toset(["Allow s3:* *", "Allow bedrock:* *"])
    error_message = "s3:* and bedrock:* on *"
  }
  assert {
    condition     = aws_eks_pod_identity_association.app.namespace == "chatbot" && aws_eks_pod_identity_association.app.service_account == "chatbot-server" && aws_eks_pod_identity_association.app.cluster_name == "aikido-demo-eks"
    error_message = "pod identity association must target chatbot/chatbot-server"
  }
}
