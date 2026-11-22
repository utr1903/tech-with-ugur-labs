variable "env" {
  description = "Environment name (dev or prod); part of every resource name."
  type        = string

  validation {
    condition     = can(regex("^[a-z]{2,8}$", var.env))
    error_message = "env must be 2-8 lowercase letters, e.g. dev or prod."
  }
}

variable "org_id" {
  description = "GCP organization the project is created under."
  type        = string
}

variable "billing_account" {
  description = "Billing account linked to the project."
  type        = string
}

variable "region" {
  description = "GCP region of the subnet, bucket and Artifact Registry repository."
  type        = string
}

variable "zone" {
  description = "GCP zone of the VM."
  type        = string
}

variable "own_customer_id" {
  description = "Our Cloud Identity customer id (allowed by domain-restricted sharing)."
  type        = string
}

variable "aikido_customer_id" {
  description = "Aikido's Cloud Identity customer id (allowed by domain-restricted sharing)."
  type        = string
}

variable "vm_image" {
  description = "Boot image of the VM, pinned to an old Debian 12 build on purpose (outdated packages for VM scanning)."
  type        = string
  default     = "projects/debian-cloud/global/images/debian-12-bookworm-v20230609"
}

variable "vm_scanner_member" {
  description = "IAM member of the Aikido-managed service account that the VM-connect wizard grants the snapshot custom roles to (not the -batch SA, which is used only for VPC Service Controls)."
  type        = string
  default     = "serviceAccount:aikido-vm-scanner@aikido-vm-scanning.iam.gserviceaccount.com"
}

variable "internal_vm" {
  description = "Also deploy an internal-only twin of the files-app VM (no external IP, egress via Cloud NAT) for exposure-based prioritisation tests."
  type        = bool
  default     = false
}
