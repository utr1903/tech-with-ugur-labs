variable "region" {
  description = "AWS region to deploy into."
  type        = string
  default     = "eu-central-1"
}

variable "name_prefix" {
  description = "Prefix for all resource names."
  type        = string
  default     = "aikido-demo"
}

variable "vpc_cidr" {
  description = "CIDR block of the VPC."
  type        = string
  default     = "10.0.0.0/16"
}

variable "kubernetes_version" {
  description = "EKS Kubernetes version (latest in standard support)."
  type        = string
  default     = "1.37"
}

variable "node_instance_type" {
  description = "EC2 instance type of the EKS managed node group."
  type        = string
  default     = "t3.medium"
}

variable "node_count" {
  description = "Number of nodes in the EKS managed node group."
  type        = number
  default     = 2
}

variable "app_namespace" {
  description = "Kubernetes namespace of the demo application."
  type        = string
  default     = "chatbot"
}

variable "app_service_account" {
  description = "Kubernetes service account of the demo application."
  type        = string
  default     = "chatbot-server"
}

variable "aikido_principal_arn" {
  description = "ARN of the Aikido principal allowed to assume the read-only role."
  type        = string
  default     = "arn:aws:iam::881830977366:role/service-role/lambda-aws-cloud-findings-role-uox26vzd"
}

variable "aikido_vm_principal_arn" {
  description = "ARN of the Aikido EBS scanner principal allowed to assume the VM scanner role."
  type        = string
  default     = "arn:aws:iam::881830977366:role/aws-ebs-scanner-role"
}

variable "aikido_ecr_principal_arn" {
  description = "ARN of the Aikido container image scanner principal allowed to assume the ECR read-only role."
  type        = string
  default     = "arn:aws:iam::881830977366:role/service-role/lambda-container-image-scanner-role-pb0qotst"
}

variable "aikido_external_id" {
  description = "External ID Aikido must present (aikido-<workspace id>; deploy.sh derives it from the Aikido API)."
  type        = string

  validation {
    condition     = can(regex("^aikido-[0-9]+$", var.aikido_external_id))
    error_message = "aikido_external_id must look like aikido-<workspace id>, e.g. aikido-123456."
  }
}
