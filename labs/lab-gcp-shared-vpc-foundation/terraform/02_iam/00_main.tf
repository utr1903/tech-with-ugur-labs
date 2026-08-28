terraform {
  required_version = "= 1.14.8"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "7.46.0"
    }
  }
}

provider "google" {}
