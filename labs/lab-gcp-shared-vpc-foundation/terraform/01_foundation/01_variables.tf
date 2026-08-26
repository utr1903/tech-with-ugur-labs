variable "org_id" {
  description = "Numeric GCP organization ID the folders are created under."
  type        = string
}

variable "billing_account" {
  description = "Billing account ID attached to all three projects."
  type        = string
}
