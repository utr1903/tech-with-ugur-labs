resource "random_id" "instance_suffix" {
  byte_length = 3
}

resource "google_sql_database_instance" "postgres" {
  name                = "${local.instance_prefix}-${random_id.instance_suffix.hex}"
  database_version    = var.database_version
  region              = var.region
  deletion_protection = false

  settings {
    tier    = var.tier
    edition = "ENTERPRISE"

    ip_configuration {
      ipv4_enabled = true

      authorized_networks {
        name  = "reader"
        value = var.authorized_cidr
      }
    }
  }

  depends_on = [google_project_service.sqladmin]
}

# The database and user are abandoned on destroy instead of deleted:
# the drill's tables are owned by the app user, and Cloud SQL refuses
# to drop a Postgres role that still owns objects, which made the
# first destroy attempt fail. The instance deletion right after wipes
# both anyway, so skipping their individual deletes makes teardown
# succeed in a single pass.
resource "google_sql_database" "app" {
  name     = var.db_name
  instance = google_sql_database_instance.postgres.name

  deletion_policy = "ABANDON"
}

resource "random_password" "db_user" {
  length  = 24
  special = false
}

resource "google_sql_user" "app" {
  name     = var.db_user
  instance = google_sql_database_instance.postgres.name
  password = random_password.db_user.result

  deletion_policy = "ABANDON"
}

output "project_id" {
  value = var.project_id
}

output "instance_name" {
  value = google_sql_database_instance.postgres.name
}

output "public_ip" {
  value = google_sql_database_instance.postgres.public_ip_address
}

output "db_name" {
  value = google_sql_database.app.name
}

output "db_user" {
  value = google_sql_user.app.name
}

output "db_password" {
  value     = random_password.db_user.result
  sensitive = true
}
