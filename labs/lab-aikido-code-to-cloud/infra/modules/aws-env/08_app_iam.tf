resource "aws_iam_role" "app" {
  name = "${var.name_prefix}-chatbot-server"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = {
        Service = "pods.eks.amazonaws.com"
      }
      Action = ["sts:AssumeRole", "sts:TagSession"]
    }]
  })
}

resource "aws_iam_role_policy" "app" {
  name = "${var.name_prefix}-chatbot-server"
  role = aws_iam_role.app.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        # INSECURE-BY-DESIGN: wildcard s3:* on *
        # (least privilege: s3:GetObject/PutObject/ListBucket on the data bucket only)
        Action   = "s3:*"
        Resource = "*"
      },
      {
        Effect = "Allow"
        # INSECURE-BY-DESIGN: wildcard bedrock:* on *
        # (least privilege: bedrock:InvokeModel*/Converse* on the Nova 2 Lite inference profile only)
        Action   = "bedrock:*"
        Resource = "*"
      },
    ]
  })
}

resource "aws_eks_pod_identity_association" "app" {
  cluster_name    = aws_eks_cluster.this.name
  namespace       = var.app_namespace
  service_account = var.app_service_account
  role_arn        = aws_iam_role.app.arn

  depends_on = [aws_eks_addon.pre_node]
}
