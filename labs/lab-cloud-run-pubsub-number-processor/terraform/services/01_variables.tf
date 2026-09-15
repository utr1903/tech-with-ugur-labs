variable "project_id" {
  type        = string
  description = "Existing billing-enabled project ID."
}
variable "region" {
  type    = string
  default = "europe-west1"
}
variable "lab_name" {
  type    = string
  default = "number-pipeline"
  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{2,17}[a-z0-9]$", var.lab_name))
    error_message = "Use 4–19 lowercase letters, digits or hyphens."
  }
}
variable "server_image" {
  type        = string
  description = "Immutable Artifact Registry image reference."
  validation {
    condition     = can(regex("^${var.region}-docker[.]pkg[.]dev/${var.project_id}/${var.lab_name}-server/app@sha256:[a-f0-9]{64}$", var.server_image))
    error_message = "Use this lab's server image pinned with @sha256 and 64 lowercase hex digits."
  }
}
variable "processor_image" {
  type        = string
  description = "Immutable Artifact Registry image reference."
  validation {
    condition     = can(regex("^${var.region}-docker[.]pkg[.]dev/${var.project_id}/${var.lab_name}-processor/app@sha256:[a-f0-9]{64}$", var.processor_image))
    error_message = "Use this lab's processor image pinned with @sha256 and 64 lowercase hex digits."
  }
}
