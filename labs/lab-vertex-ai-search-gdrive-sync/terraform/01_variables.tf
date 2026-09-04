variable "project_id" {
  description = "GCP project that hosts the staging bucket, the Vertex AI Search app and the sync service account. Billing must be enabled."
  type        = string
}

variable "drive_id" {
  description = "ID of the Google Drive shared drive holding the corpus. Taken from the shared drive URL: drive.google.com/drive/folders/<drive_id>. The Workspace tenant may be in a completely different organization from this GCP project."
  type        = string
}

variable "region" {
  description = "Region for the Cloud Storage staging bucket."
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
  description = "Prefix for the bucket, data store, search app and service account names. Deleting a data store reserves its ID for hours, so bump this when redeploying after a destroy."
  type        = string
  default     = "gdrive-sync"
}
