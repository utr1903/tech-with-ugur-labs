terraform {
  required_version = "= 1.14.8"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "7.46.0"
    }
    tls = {
      source  = "hashicorp/tls"
      version = "4.3.0"
    }
    local = {
      source  = "hashicorp/local"
      version = "2.9.0"
    }
  }
}

provider "google" {}
