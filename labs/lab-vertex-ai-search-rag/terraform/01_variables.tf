variable "project_id" {
  description = "GCP project that hosts the corpus bucket and the Vertex AI Search app. Billing must be enabled."
  type        = string
}

variable "region" {
  description = "Region for the Cloud Storage corpus bucket."
  type        = string
  default     = "europe-west1"
}

variable "search_location" {
  description = "Vertex AI Search location. One of global, us, eu. global has the widest feature support."
  type        = string
  default     = "global"

  validation {
    condition     = contains(["global", "us", "eu"], var.search_location)
    error_message = "search_location must be one of: global, us, eu."
  }
}

variable "resource_prefix" {
  description = "Prefix for the bucket, data store and search app names. Must be unique enough for a global bucket name."
  type        = string
  default     = "vertex-search-rag"
}
