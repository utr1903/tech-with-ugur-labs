terraform {
  required_version = "= 1.14.8"

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

# The Discovery Engine API refuses calls that carry no quota project, and
# Terraform does not pick one up from your Application Default Credentials on
# its own. These two settings tell it to bill the API call to your own project.
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
