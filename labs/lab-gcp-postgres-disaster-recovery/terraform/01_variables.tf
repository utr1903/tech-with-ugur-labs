variable "project_id" {
  description = "GCP project to deploy into (billing must be enabled)."
  type        = string
}

variable "region" {
  description = "Region for the Cloud SQL instance."
  type        = string
  default     = "europe-west3"
}

variable "database_version" {
  description = "Cloud SQL Postgres version."
  type        = string
  default     = "POSTGRES_17"
}

variable "tier" {
  description = "Machine tier for the instance (smallest shared-core by default)."
  type        = string
  default     = "db-f1-micro"
}

variable "authorized_cidr" {
  description = "Your public IP in CIDR notation (e.g. 203.0.113.7/32); the only network allowed to reach the instance. No default on purpose."
  type        = string
}

variable "db_name" {
  description = "Application database name."
  type        = string
  default     = "shop"
}

variable "db_user" {
  description = "Application database user."
  type        = string
  default     = "drill"
}
