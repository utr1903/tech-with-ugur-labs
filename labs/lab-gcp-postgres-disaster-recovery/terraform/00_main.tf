terraform {
  required_version = "= 1.14.8"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "7.45.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "3.9.0"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}
