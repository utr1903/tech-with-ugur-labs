resource "random_id" "suffix" {
  byte_length = 2
}

locals {
  name       = "aikido-demo-${var.env}"
  project_id = "${local.name}-${random_id.suffix.hex}"
  parent     = "projects/${google_project.this.project_id}"
  registry   = "${var.region}-docker.pkg.dev/${google_project.this.project_id}/${google_artifact_registry_repository.this.repository_id}"

  services = toset([
    # Aikido GCP CSPM
    "compute.googleapis.com",
    "storage-component.googleapis.com",
    "iam.googleapis.com",
    "container.googleapis.com",
    "logging.googleapis.com",
    "monitoring.googleapis.com",
    "cloudresourcemanager.googleapis.com",
    "cloudkms.googleapis.com",
    "bigquery.googleapis.com",
    "dns.googleapis.com",
    "sqladmin.googleapis.com",
    # demo
    "artifactregistry.googleapis.com",
    "orgpolicy.googleapis.com",
    "storage.googleapis.com",
    "serviceusage.googleapis.com",
  ])
}

resource "google_project" "this" {
  name                = local.project_id
  project_id          = local.project_id
  org_id              = var.org_id
  billing_account     = var.billing_account
  auto_create_network = false
  deletion_policy     = "DELETE"

  labels = {
    env     = var.env
    project = "aikido-demo"
  }
}

resource "google_project_service" "this" {
  for_each = local.services

  project            = google_project.this.project_id
  service            = each.value
  disable_on_destroy = false
}

# Org policy overrides on this project only (the org itself is never touched).

resource "google_org_policy_policy" "allowed_member_domains" {
  name   = "${local.parent}/policies/iam.allowedPolicyMemberDomains"
  parent = local.parent

  spec {
    rules {
      values {
        allowed_values = [var.own_customer_id, var.aikido_customer_id]
      }
    }
  }

  depends_on = [google_project_service.this]
}

resource "google_org_policy_policy" "sa_key_creation" {
  name   = "${local.parent}/policies/iam.managed.disableServiceAccountKeyCreation"
  parent = local.parent

  spec {
    rules {
      enforce = "FALSE"
    }
  }

  depends_on = [google_project_service.this]
}

resource "google_org_policy_policy" "uniform_bucket_access" {
  name   = "${local.parent}/policies/storage.uniformBucketLevelAccess"
  parent = local.parent

  spec {
    rules {
      enforce = "FALSE"
    }
  }

  depends_on = [google_project_service.this]
}

# Org policy changes take a minute or two to propagate. Everything they
# unblock (SA keys, the non-UBLA bucket, the cross-domain VM-scanner bindings)
# depends on this wait.
resource "time_sleep" "org_policy" {
  create_duration = "90s"

  depends_on = [
    google_org_policy_policy.allowed_member_domains,
    google_org_policy_policy.sa_key_creation,
    google_org_policy_policy.uniform_bucket_access,
  ]
}
