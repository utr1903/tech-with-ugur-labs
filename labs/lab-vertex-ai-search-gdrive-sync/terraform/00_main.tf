terraform {
  required_version = ">= 1.9.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "8.1.0"
    }
    google-beta = {
      source  = "hashicorp/google-beta"
      version = "8.1.0"
    }
    local = {
      source  = "hashicorp/local"
      version = "2.9.0"
    }
  }
}

# Application Default Credentials carry no quota project by default, and the
# Discovery Engine API refuses calls without one. These two settings are what
# make Terraform bill to the lab project instead of failing on a missing quota
# project — without them, apply fails on the second resource every time.
provider "google" {
  project               = var.project_id
  billing_project       = var.project_id
  user_project_override = true
}

provider "google-beta" {
  project               = var.project_id
  billing_project       = var.project_id
  user_project_override = true
}
