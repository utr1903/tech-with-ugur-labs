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
variable "legacy_token_creator" {
  type        = bool
  default     = false
  description = "Opt in only if the Pub/Sub service agent lacks inherited token-minting permission."
}
