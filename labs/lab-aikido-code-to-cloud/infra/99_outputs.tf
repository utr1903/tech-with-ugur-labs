output "region" {
  description = "AWS region the demo is deployed into."
  value       = module.aws.region
}

output "account_id" {
  description = "AWS account ID the demo is deployed into."
  value       = module.aws.account_id
}

output "vpc_id" {
  description = "ID of the demo VPC."
  value       = module.aws.vpc_id
}

output "public_subnet_ids" {
  description = "IDs of the public subnets."
  value       = module.aws.public_subnet_ids
}

output "cluster_name" {
  description = "Name of the EKS cluster."
  value       = module.aws.cluster_name
}

output "cluster_endpoint" {
  description = "API server endpoint of the EKS cluster."
  value       = module.aws.cluster_endpoint
}

output "cluster_version" {
  description = "Kubernetes version of the EKS cluster."
  value       = module.aws.cluster_version
}

output "data_bucket_name" {
  description = "Name of the S3 data bucket."
  value       = module.aws.data_bucket_name
}

output "data_bucket_arn" {
  description = "ARN of the S3 data bucket."
  value       = module.aws.data_bucket_arn
}

output "ecr_repository_url" {
  description = "URL of the ECR repository for the chatbot server image."
  value       = module.aws.ecr_repository_url
}

output "app_role_arn" {
  description = "ARN of the over-privileged IAM role assumed by the chatbot pod via EKS Pod Identity."
  value       = module.aws.app_role_arn
}

output "aikido_role_arn" {
  description = "ARN of the read-only IAM role Aikido assumes (registered with Aikido by make deploy)."
  value       = module.aws.aikido_role_arn
}

output "aikido_vm_role_arn" {
  description = "ARN of the EBS snapshot role Aikido assumes for VM scanning (register it in the Aikido UI)."
  value       = module.aws.aikido_vm_role_arn
}

output "aikido_ecr_role_arn" {
  description = "ARN of the ECR read-only role Aikido assumes for container image scanning (register it in the Aikido UI)."
  value       = module.aws.aikido_ecr_role_arn
}

output "gcp" {
  description = "GCP environments: env => { project_id, vm_ip, internal_vm_name, internal_vm_ip, bucket, registry } (internal_* null outside prod)."
  value = { for e, m in module.gcp : e => {
    project_id       = m.project_id
    vm_ip            = m.vm_ip
    internal_vm_name = m.internal_vm_name
    internal_vm_ip   = m.internal_vm_ip
    bucket           = m.bucket
    registry         = m.registry
  } }
}

output "gcp_aikido_keys" {
  description = "Base64 JSON keys of the Aikido SAs: env => { cspm, registry }."
  value = { for e, m in module.gcp : e => {
    cspm     = m.cspm_key
    registry = m.registry_key
  } }
  sensitive = true
}
