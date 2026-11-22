output "region" {
  description = "AWS region the demo is deployed into."
  value       = var.region
}

output "account_id" {
  description = "AWS account ID the demo is deployed into."
  value       = local.account_id
}

output "vpc_id" {
  description = "ID of the demo VPC."
  value       = aws_vpc.this.id
}

output "public_subnet_ids" {
  description = "IDs of the public subnets."
  value       = aws_subnet.public[*].id
}

output "cluster_name" {
  description = "Name of the EKS cluster."
  value       = aws_eks_cluster.this.name
}

output "cluster_endpoint" {
  description = "API server endpoint of the EKS cluster."
  value       = aws_eks_cluster.this.endpoint
}

output "cluster_version" {
  description = "Kubernetes version of the EKS cluster."
  value       = aws_eks_cluster.this.version
}

output "data_bucket_name" {
  description = "Name of the S3 data bucket."
  value       = aws_s3_bucket.data.bucket
}

output "data_bucket_arn" {
  description = "ARN of the S3 data bucket."
  value       = aws_s3_bucket.data.arn
}

output "ecr_repository_url" {
  description = "URL of the ECR repository for the chatbot server image."
  value       = aws_ecr_repository.server.repository_url
}

output "app_role_arn" {
  description = "ARN of the over-privileged IAM role assumed by the chatbot pod via EKS Pod Identity."
  value       = aws_iam_role.app.arn
}

output "aikido_role_arn" {
  description = "ARN of the read-only IAM role Aikido assumes (registered with Aikido by make deploy)."
  value       = aws_iam_role.aikido.arn
}

output "aikido_vm_role_arn" {
  description = "ARN of the EBS snapshot role Aikido assumes for VM scanning (register it in the Aikido UI)."
  value       = aws_iam_role.aikido_vm.arn
}

output "aikido_ecr_role_arn" {
  description = "ARN of the ECR read-only role Aikido assumes for container image scanning (register it in the Aikido UI)."
  value       = aws_iam_role.aikido_ecr.arn
}
