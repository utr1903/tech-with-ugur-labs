# The gcp-env module, planned once per environment with fixed random suffixes.
# Assertions on module-internal resources must run against the module itself
# (a root-level run only sees module outputs), so module_dev and module_prod
# carry the same assertions; the last run checks the root wiring of both envs.
# Keep module_dev and module_prod identical apart from env / suffix, except that
# prod also sets internal_vm = true and asserts the internal twin VM. 

variables {
  aikido_external_id  = "aikido-123456"
  gcp_org_id          = "123456789012"
  gcp_billing_account = "000000-AAAAAA-000000"
  gcp_own_customer_id = "C00000000"
}

run "module_dev" {
  command = plan

  module {
    source = "./modules/gcp-env"
  }

  variables {
    env                = "dev"
    org_id             = "123456789012"
    billing_account    = "000000-AAAAAA-000000"
    region             = "europe-west3"
    zone               = "europe-west3-a"
    own_customer_id    = "C00000000"
    aikido_customer_id = "C016qe815"
  }

  override_resource {
    target          = random_id.suffix
    override_during = plan
    values = {
      hex     = "ab12"
      dec     = "43794"
      b64_url = "qxI"
      b64_std = "qxI="
      id      = "qxI"
    }
  }

  assert {
    condition     = google_project.this.project_id == "aikido-demo-dev-ab12"
    error_message = "project id must be aikido-demo-<env>-<hex>"
  }
  assert {
    condition = (
      google_project.this.deletion_policy == "DELETE" &&
      google_project.this.billing_account == "000000-AAAAAA-000000" &&
      google_project.this.org_id == "123456789012" &&
      google_project.this.labels["env"] == "dev" &&
      google_project.this.labels["project"] == "aikido-demo"
    )
    error_message = "project must be deletable, billed, under the org and labelled"
  }
  assert {
    condition = toset([for s in google_project_service.this : s.service]) == toset([
      "compute.googleapis.com", "storage-component.googleapis.com", "iam.googleapis.com",
      "container.googleapis.com", "logging.googleapis.com", "monitoring.googleapis.com",
      "cloudresourcemanager.googleapis.com", "cloudkms.googleapis.com", "bigquery.googleapis.com",
      "dns.googleapis.com", "sqladmin.googleapis.com",
      "artifactregistry.googleapis.com", "orgpolicy.googleapis.com", "storage.googleapis.com",
      "serviceusage.googleapis.com",
    ])
    error_message = "APIs: Aikido's 11 + artifactregistry, orgpolicy, storage, serviceusage"
  }
  assert {
    condition     = alltrue([for s in google_project_service.this : s.disable_on_destroy == false])
    error_message = "APIs must not be disabled on destroy"
  }

  # Org policy overrides (project-level only)
  assert {
    condition = (
      google_org_policy_policy.allowed_member_domains.name == "projects/aikido-demo-dev-ab12/policies/iam.allowedPolicyMemberDomains" &&
      google_org_policy_policy.allowed_member_domains.parent == "projects/aikido-demo-dev-ab12" &&
      toset(google_org_policy_policy.allowed_member_domains.spec[0].rules[0].values[0].allowed_values) == toset(["C00000000", "C016qe815"])
    )
    error_message = "iam.allowedPolicyMemberDomains must allow our and Aikido's customer ids on the project"
  }
  assert {
    condition = (
      google_org_policy_policy.sa_key_creation.name == "projects/aikido-demo-dev-ab12/policies/iam.managed.disableServiceAccountKeyCreation" &&
      google_org_policy_policy.sa_key_creation.spec[0].rules[0].enforce == "FALSE"
    )
    error_message = "iam.managed.disableServiceAccountKeyCreation must be not enforced on the project"
  }
  assert {
    condition = (
      google_org_policy_policy.uniform_bucket_access.name == "projects/aikido-demo-dev-ab12/policies/storage.uniformBucketLevelAccess" &&
      google_org_policy_policy.uniform_bucket_access.spec[0].rules[0].enforce == "FALSE"
    )
    error_message = "storage.uniformBucketLevelAccess must be not enforced on the project"
  }
  assert {
    condition     = time_sleep.org_policy.create_duration == "90s"
    error_message = "org policy propagation wait must be 90s"
  }

  # Network
  assert {
    condition = (
      google_compute_network.this.name == "aikido-demo-dev" &&
      google_compute_network.this.auto_create_subnetworks == false &&
      google_compute_subnetwork.this.ip_cidr_range == "10.20.0.0/24" &&
      google_compute_subnetwork.this.region == "europe-west3"
    )
    error_message = "custom VPC aikido-demo-<env> with a 10.20.0.0/24 subnet"
  }
  assert {
    condition = (
      toset(google_compute_firewall.ingress.source_ranges) == toset(["0.0.0.0/0"]) &&
      one(google_compute_firewall.ingress.allow).protocol == "tcp" &&
      tolist(one(google_compute_firewall.ingress.allow).ports) == tolist(["22", "8080"])
    )
    error_message = "firewall opens tcp 22 and 8080 to 0.0.0.0/0"
  }

  # VM
  assert {
    condition = (
      google_compute_instance.vm["public"].machine_type == "e2-small" &&
      google_compute_instance.vm["public"].zone == "europe-west3-a" &&
      google_compute_instance.vm["public"].boot_disk[0].initialize_params[0].image == "projects/debian-cloud/global/images/debian-12-bookworm-v20230609"
    )
    error_message = "VM: e2-small in europe-west3-a on the pinned old Debian image"
  }
  assert {
    condition = (
      google_compute_instance.vm["public"].metadata["enable-oslogin"] == "FALSE" &&
      google_compute_instance.vm["public"].metadata["serial-port-enable"] == "TRUE" &&
      length(google_compute_instance.vm["public"].network_interface[0].access_config) == 1 &&
      google_compute_instance.vm["public"].shielded_instance_config[0].enable_secure_boot == false &&
      google_compute_instance.vm["public"].shielded_instance_config[0].enable_vtpm == false &&
      google_compute_instance.vm["public"].shielded_instance_config[0].enable_integrity_monitoring == false &&
      toset(google_compute_instance.vm["public"].service_account[0].scopes) == toset(["https://www.googleapis.com/auth/cloud-platform"])
    )
    error_message = "cloud-platform scope, public IP, no shielded VM, OS Login off, serial port on"
  }
  assert {
    condition = (
      strcontains(google_compute_instance.vm["public"].metadata_startup_script, "StartLimitIntervalSec=0") &&
      strcontains(google_compute_instance.vm["public"].metadata_startup_script, "Restart=always") &&
      strcontains(google_compute_instance.vm["public"].metadata_startup_script, "RestartSec=15") &&
      strcontains(google_compute_instance.vm["public"].metadata_startup_script, "systemctl mask unattended-upgrades") &&
      strcontains(google_compute_instance.vm["public"].metadata_startup_script, "systemctl disable --now apt-daily.timer apt-daily-upgrade.timer") &&
      strcontains(google_compute_instance.vm["public"].metadata_startup_script, "systemctl mask apt-daily.timer apt-daily-upgrade.timer") &&
      strcontains(google_compute_instance.vm["public"].metadata_startup_script, "APT::Periodic::Unattended-Upgrade \"0\";") &&
      strcontains(google_compute_instance.vm["public"].metadata_startup_script, "docker login -u oauth2accesstoken --password-stdin https://europe-west3-docker.pkg.dev") &&
      strcontains(google_compute_instance.vm["public"].metadata_startup_script, "docker pull europe-west3-docker.pkg.dev/aikido-demo-dev-ab12/aikido-demo/files-app:latest") &&
      strcontains(google_compute_instance.vm["public"].metadata_startup_script, "docker run --rm --name files-app -p 8080:8080 -e BUCKET=aikido-demo-dev-data-ab12 -e APP_ENV=dev europe-west3-docker.pkg.dev/aikido-demo-dev-ab12/aikido-demo/files-app:latest")
    )
    error_message = "startup script: systemd unit retries forever and runs files-app with BUCKET / APP_ENV"
  }
  assert {
    condition = (
      google_service_account.vm.account_id == "vm-app" &&
      google_project_iam_member.vm_editor.role == "roles/editor"
    )
    error_message = "VM SA vm-app has roles/editor"
  }

  assert {
    condition = (
      tolist(google_compute_firewall.ingress.target_tags) == tolist(["files-app-public"]) &&
      tolist(google_compute_instance.vm["public"].tags) == tolist(["files-app-public"]) &&
      google_compute_instance.vm["public"].name == "aikido-demo-dev-files-app"
    )
    error_message = "the 0.0.0.0/0 rule targets only the public VM's tag"
  }
  assert {
    condition = (
      keys(google_compute_instance.vm) == ["public"] &&
      length(google_compute_firewall.ingress_internal) == 0 &&
      length(google_compute_router.nat) == 0 &&
      length(google_compute_router_nat.this) == 0 &&
      output.internal_vm_name == null && output.internal_vm_ip == null
    )
    error_message = "dev: only the public VM, no internal rule, router or NAT"
  }

  # Storage
  assert {
    condition = (
      google_storage_bucket.data.name == "aikido-demo-dev-data-ab12" &&
      google_storage_bucket.data.location == "EUROPE-WEST3" &&
      google_storage_bucket.data.uniform_bucket_level_access == false &&
      google_storage_bucket.data.force_destroy == true &&
      length(google_storage_bucket.data.retention_policy) == 0
    )
    error_message = "bucket aikido-demo-<env>-data-<hex> without UBLA, versioning or retention"
  }
  assert {
    condition = (
      google_artifact_registry_repository.this.repository_id == "aikido-demo" &&
      google_artifact_registry_repository.this.format == "DOCKER" &&
      google_artifact_registry_repository.this.location == "europe-west3" &&
      output.registry == "europe-west3-docker.pkg.dev/aikido-demo-dev-ab12/aikido-demo"
    )
    error_message = "Artifact Registry docker repo aikido-demo in the region"
  }

  # Aikido SAs and VM-scanner roles
  assert {
    condition = (
      google_service_account.aikido_cspm.account_id == "aikido-cspm" &&
      toset([for m in google_project_iam_member.aikido_cspm : m.role]) == toset(["roles/viewer", "roles/iam.securityReviewer"]) &&
      google_service_account.aikido_registry.account_id == "aikido-registry" &&
      google_project_iam_member.aikido_registry.role == "roles/artifactregistry.reader"
    )
    error_message = "Aikido SAs: cspm (viewer + securityReviewer), registry (artifactregistry.reader)"
  }
  assert {
    condition = toset(google_project_iam_custom_role.vm_scanner.permissions) == toset([
      "compute.instances.list", "compute.instanceGroups.get", "compute.instanceGroups.list",
      "compute.disks.createSnapshot", "compute.disks.get", "compute.snapshots.create",
      "compute.snapshots.get", "compute.snapshots.list", "compute.snapshots.setLabels",
      "compute.snapshots.useReadOnly",
    ])
    error_message = "VM-scanner role permissions must equal the spec's 10"
  }
  assert {
    condition = (
      google_project_iam_custom_role.vm_scanner.role_id == "aikidoSecurityVmScannerRole" &&
      google_project_iam_custom_role.vm_scanner_snapshot_delete.role_id == "aikidoSecurityVmScannerSnapshotDeleteRole" &&
      toset(google_project_iam_custom_role.vm_scanner_snapshot_delete.permissions) == toset(["compute.snapshots.delete"]) &&
      google_project_iam_member.vm_scanner.member == "serviceAccount:aikido-vm-scanner@aikido-vm-scanning.iam.gserviceaccount.com" &&
      google_project_iam_member.vm_scanner_snapshot_delete.member == "serviceAccount:aikido-vm-scanner@aikido-vm-scanning.iam.gserviceaccount.com" &&
      google_project_iam_member.vm_scanner_snapshot_delete.condition[0].expression == "resource.type == \"compute.googleapis.com/Snapshot\" && resource.name.extract(\"/global/snapshots/{name}\").startsWith(\"aik-snapshot-\")"
    )
    error_message = "VM-scanner roles bound to Aikido's managed scanner SA, snapshot delete limited to aik-snapshot-*"
  }
}

run "module_prod" {
  command = plan

  module {
    source = "./modules/gcp-env"
  }

  variables {
    env                = "prod"
    internal_vm        = true
    org_id             = "123456789012"
    billing_account    = "000000-AAAAAA-000000"
    region             = "europe-west3"
    zone               = "europe-west3-a"
    own_customer_id    = "C00000000"
    aikido_customer_id = "C016qe815"
  }

  override_resource {
    target          = random_id.suffix
    override_during = plan
    values = {
      hex     = "cd34"
      dec     = "52532"
      b64_url = "zTQ"
      b64_std = "zTQ="
      id      = "zTQ"
    }
  }

  assert {
    condition     = google_project.this.project_id == "aikido-demo-prod-cd34"
    error_message = "project id must be aikido-demo-<env>-<hex>"
  }
  assert {
    condition = (
      google_project.this.deletion_policy == "DELETE" &&
      google_project.this.billing_account == "000000-AAAAAA-000000" &&
      google_project.this.org_id == "123456789012" &&
      google_project.this.labels["env"] == "prod" &&
      google_project.this.labels["project"] == "aikido-demo"
    )
    error_message = "project must be deletable, billed, under the org and labelled"
  }
  assert {
    condition = toset([for s in google_project_service.this : s.service]) == toset([
      "compute.googleapis.com", "storage-component.googleapis.com", "iam.googleapis.com",
      "container.googleapis.com", "logging.googleapis.com", "monitoring.googleapis.com",
      "cloudresourcemanager.googleapis.com", "cloudkms.googleapis.com", "bigquery.googleapis.com",
      "dns.googleapis.com", "sqladmin.googleapis.com",
      "artifactregistry.googleapis.com", "orgpolicy.googleapis.com", "storage.googleapis.com",
      "serviceusage.googleapis.com",
    ])
    error_message = "APIs: Aikido's 11 + artifactregistry, orgpolicy, storage, serviceusage"
  }
  assert {
    condition     = alltrue([for s in google_project_service.this : s.disable_on_destroy == false])
    error_message = "APIs must not be disabled on destroy"
  }

  # Org policy overrides (project-level only)
  assert {
    condition = (
      google_org_policy_policy.allowed_member_domains.name == "projects/aikido-demo-prod-cd34/policies/iam.allowedPolicyMemberDomains" &&
      google_org_policy_policy.allowed_member_domains.parent == "projects/aikido-demo-prod-cd34" &&
      toset(google_org_policy_policy.allowed_member_domains.spec[0].rules[0].values[0].allowed_values) == toset(["C00000000", "C016qe815"])
    )
    error_message = "iam.allowedPolicyMemberDomains must allow our and Aikido's customer ids on the project"
  }
  assert {
    condition = (
      google_org_policy_policy.sa_key_creation.name == "projects/aikido-demo-prod-cd34/policies/iam.managed.disableServiceAccountKeyCreation" &&
      google_org_policy_policy.sa_key_creation.spec[0].rules[0].enforce == "FALSE"
    )
    error_message = "iam.managed.disableServiceAccountKeyCreation must be not enforced on the project"
  }
  assert {
    condition = (
      google_org_policy_policy.uniform_bucket_access.name == "projects/aikido-demo-prod-cd34/policies/storage.uniformBucketLevelAccess" &&
      google_org_policy_policy.uniform_bucket_access.spec[0].rules[0].enforce == "FALSE"
    )
    error_message = "storage.uniformBucketLevelAccess must be not enforced on the project"
  }
  assert {
    condition     = time_sleep.org_policy.create_duration == "90s"
    error_message = "org policy propagation wait must be 90s"
  }

  # Network
  assert {
    condition = (
      google_compute_network.this.name == "aikido-demo-prod" &&
      google_compute_network.this.auto_create_subnetworks == false &&
      google_compute_subnetwork.this.ip_cidr_range == "10.20.0.0/24" &&
      google_compute_subnetwork.this.region == "europe-west3"
    )
    error_message = "custom VPC aikido-demo-<env> with a 10.20.0.0/24 subnet"
  }
  assert {
    condition = (
      toset(google_compute_firewall.ingress.source_ranges) == toset(["0.0.0.0/0"]) &&
      one(google_compute_firewall.ingress.allow).protocol == "tcp" &&
      tolist(one(google_compute_firewall.ingress.allow).ports) == tolist(["22", "8080"])
    )
    error_message = "firewall opens tcp 22 and 8080 to 0.0.0.0/0"
  }

  # VM
  assert {
    condition = (
      google_compute_instance.vm["public"].machine_type == "e2-small" &&
      google_compute_instance.vm["public"].zone == "europe-west3-a" &&
      google_compute_instance.vm["public"].boot_disk[0].initialize_params[0].image == "projects/debian-cloud/global/images/debian-12-bookworm-v20230609"
    )
    error_message = "VM: e2-small in europe-west3-a on the pinned old Debian image"
  }
  assert {
    condition = (
      google_compute_instance.vm["public"].metadata["enable-oslogin"] == "FALSE" &&
      google_compute_instance.vm["public"].metadata["serial-port-enable"] == "TRUE" &&
      length(google_compute_instance.vm["public"].network_interface[0].access_config) == 1 &&
      google_compute_instance.vm["public"].shielded_instance_config[0].enable_secure_boot == false &&
      google_compute_instance.vm["public"].shielded_instance_config[0].enable_vtpm == false &&
      google_compute_instance.vm["public"].shielded_instance_config[0].enable_integrity_monitoring == false &&
      toset(google_compute_instance.vm["public"].service_account[0].scopes) == toset(["https://www.googleapis.com/auth/cloud-platform"])
    )
    error_message = "cloud-platform scope, public IP, no shielded VM, OS Login off, serial port on"
  }
  assert {
    condition = (
      strcontains(google_compute_instance.vm["public"].metadata_startup_script, "StartLimitIntervalSec=0") &&
      strcontains(google_compute_instance.vm["public"].metadata_startup_script, "Restart=always") &&
      strcontains(google_compute_instance.vm["public"].metadata_startup_script, "RestartSec=15") &&
      strcontains(google_compute_instance.vm["public"].metadata_startup_script, "systemctl mask unattended-upgrades") &&
      strcontains(google_compute_instance.vm["public"].metadata_startup_script, "systemctl disable --now apt-daily.timer apt-daily-upgrade.timer") &&
      strcontains(google_compute_instance.vm["public"].metadata_startup_script, "systemctl mask apt-daily.timer apt-daily-upgrade.timer") &&
      strcontains(google_compute_instance.vm["public"].metadata_startup_script, "APT::Periodic::Unattended-Upgrade \"0\";") &&
      strcontains(google_compute_instance.vm["public"].metadata_startup_script, "docker login -u oauth2accesstoken --password-stdin https://europe-west3-docker.pkg.dev") &&
      strcontains(google_compute_instance.vm["public"].metadata_startup_script, "docker pull europe-west3-docker.pkg.dev/aikido-demo-prod-cd34/aikido-demo/files-app:latest") &&
      strcontains(google_compute_instance.vm["public"].metadata_startup_script, "docker run --rm --name files-app -p 8080:8080 -e BUCKET=aikido-demo-prod-data-cd34 -e APP_ENV=prod europe-west3-docker.pkg.dev/aikido-demo-prod-cd34/aikido-demo/files-app:latest")
    )
    error_message = "startup script: systemd unit retries forever and runs files-app with BUCKET / APP_ENV"
  }
  assert {
    condition = (
      google_service_account.vm.account_id == "vm-app" &&
      google_project_iam_member.vm_editor.role == "roles/editor"
    )
    error_message = "VM SA vm-app has roles/editor"
  }

  assert {
    condition = (
      tolist(google_compute_firewall.ingress.target_tags) == tolist(["files-app-public"]) &&
      tolist(google_compute_instance.vm["public"].tags) == tolist(["files-app-public"]) &&
      google_compute_instance.vm["public"].name == "aikido-demo-prod-files-app"
    )
    error_message = "the 0.0.0.0/0 rule targets only the public VM's tag"
  }
  assert {
    condition = (
      keys(google_compute_instance.vm) == ["internal", "public"] &&
      google_compute_instance.vm["internal"].name == "aikido-demo-prod-files-app-internal" &&
      length(google_compute_instance.vm["internal"].network_interface[0].access_config) == 0 &&
      tolist(google_compute_instance.vm["internal"].tags) == tolist(["files-app-internal"]) &&
      output.internal_vm_name == "aikido-demo-prod-files-app-internal"
    )
    error_message = "prod: internal VM without external IP, tagged files-app-internal"
  }
  assert {
    condition = alltrue([
      google_compute_instance.vm["internal"].metadata_startup_script == google_compute_instance.vm["public"].metadata_startup_script,
      google_compute_instance.vm["internal"].metadata == google_compute_instance.vm["public"].metadata,
      google_compute_instance.vm["internal"].machine_type == google_compute_instance.vm["public"].machine_type,
      google_compute_instance.vm["internal"].zone == google_compute_instance.vm["public"].zone,
      google_compute_instance.vm["internal"].boot_disk[0].initialize_params[0].image == google_compute_instance.vm["public"].boot_disk[0].initialize_params[0].image,
      google_compute_instance.vm["internal"].service_account[0].email == google_compute_instance.vm["public"].service_account[0].email,
      toset(google_compute_instance.vm["internal"].service_account[0].scopes) == toset(google_compute_instance.vm["public"].service_account[0].scopes),
      google_compute_instance.vm["internal"].shielded_instance_config == google_compute_instance.vm["public"].shielded_instance_config,
    ])
    error_message = "internal VM must match the public VM in everything but name, tag and external IP"
  }
  assert {
    condition = (
      google_compute_firewall.ingress_internal[0].name == "aikido-demo-prod-ingress-internal" &&
      toset(google_compute_firewall.ingress_internal[0].source_ranges) == toset(["10.20.0.0/24"]) &&
      tolist(google_compute_firewall.ingress_internal[0].target_tags) == tolist(["files-app-internal"]) &&
      tolist(one(google_compute_firewall.ingress_internal[0].allow).ports) == tolist(["22", "8080"])
    )
    error_message = "internal VM reachable on tcp 22/8080 from the subnet only"
  }
  assert {
    condition = (
      google_compute_router.nat[0].name == "aikido-demo-prod-router" &&
      google_compute_router.nat[0].region == "europe-west3" &&
      google_compute_router_nat.this[0].name == "aikido-demo-prod-nat" &&
      google_compute_router_nat.this[0].nat_ip_allocate_option == "AUTO_ONLY" &&
      google_compute_router_nat.this[0].source_subnetwork_ip_ranges_to_nat == "LIST_OF_SUBNETWORKS" &&
      one(google_compute_router_nat.this[0].subnetwork).source_ip_ranges_to_nat == toset(["ALL_IP_RANGES"])
    )
    error_message = "prod: Cloud NAT (egress only) for the subnet"
  }

  # Storage
  assert {
    condition = (
      google_storage_bucket.data.name == "aikido-demo-prod-data-cd34" &&
      google_storage_bucket.data.location == "EUROPE-WEST3" &&
      google_storage_bucket.data.uniform_bucket_level_access == false &&
      google_storage_bucket.data.force_destroy == true &&
      length(google_storage_bucket.data.retention_policy) == 0
    )
    error_message = "bucket aikido-demo-<env>-data-<hex> without UBLA, versioning or retention"
  }
  assert {
    condition = (
      google_artifact_registry_repository.this.repository_id == "aikido-demo" &&
      google_artifact_registry_repository.this.format == "DOCKER" &&
      google_artifact_registry_repository.this.location == "europe-west3" &&
      output.registry == "europe-west3-docker.pkg.dev/aikido-demo-prod-cd34/aikido-demo"
    )
    error_message = "Artifact Registry docker repo aikido-demo in the region"
  }

  # Aikido SAs and VM-scanner roles
  assert {
    condition = (
      google_service_account.aikido_cspm.account_id == "aikido-cspm" &&
      toset([for m in google_project_iam_member.aikido_cspm : m.role]) == toset(["roles/viewer", "roles/iam.securityReviewer"]) &&
      google_service_account.aikido_registry.account_id == "aikido-registry" &&
      google_project_iam_member.aikido_registry.role == "roles/artifactregistry.reader"
    )
    error_message = "Aikido SAs: cspm (viewer + securityReviewer), registry (artifactregistry.reader)"
  }
  assert {
    condition = toset(google_project_iam_custom_role.vm_scanner.permissions) == toset([
      "compute.instances.list", "compute.instanceGroups.get", "compute.instanceGroups.list",
      "compute.disks.createSnapshot", "compute.disks.get", "compute.snapshots.create",
      "compute.snapshots.get", "compute.snapshots.list", "compute.snapshots.setLabels",
      "compute.snapshots.useReadOnly",
    ])
    error_message = "VM-scanner role permissions must equal the spec's 10"
  }
  assert {
    condition = (
      google_project_iam_custom_role.vm_scanner.role_id == "aikidoSecurityVmScannerRole" &&
      google_project_iam_custom_role.vm_scanner_snapshot_delete.role_id == "aikidoSecurityVmScannerSnapshotDeleteRole" &&
      toset(google_project_iam_custom_role.vm_scanner_snapshot_delete.permissions) == toset(["compute.snapshots.delete"]) &&
      google_project_iam_member.vm_scanner.member == "serviceAccount:aikido-vm-scanner@aikido-vm-scanning.iam.gserviceaccount.com" &&
      google_project_iam_member.vm_scanner_snapshot_delete.member == "serviceAccount:aikido-vm-scanner@aikido-vm-scanning.iam.gserviceaccount.com" &&
      google_project_iam_member.vm_scanner_snapshot_delete.condition[0].expression == "resource.type == \"compute.googleapis.com/Snapshot\" && resource.name.extract(\"/global/snapshots/{name}\").startsWith(\"aik-snapshot-\")"
    )
    error_message = "VM-scanner roles bound to Aikido's managed scanner SA, snapshot delete limited to aik-snapshot-*"
  }
}

run "root_wiring" {
  command = plan

  override_resource {
    target          = module.gcp["dev"].random_id.suffix
    override_during = plan
    values = {
      hex     = "ab12"
      dec     = "43794"
      b64_url = "qxI"
      b64_std = "qxI="
      id      = "qxI"
    }
  }

  override_resource {
    target          = module.gcp["prod"].random_id.suffix
    override_during = plan
    values = {
      hex     = "cd34"
      dec     = "52532"
      b64_url = "zTQ"
      b64_std = "zTQ="
      id      = "zTQ"
    }
  }

  assert {
    condition     = keys(output.gcp) == ["dev", "prod"]
    error_message = "both dev and prod must be instantiated"
  }
  assert {
    condition = (
      output.gcp["dev"].project_id == "aikido-demo-dev-ab12" &&
      output.gcp["prod"].project_id == "aikido-demo-prod-cd34" &&
      output.gcp["dev"].bucket == "aikido-demo-dev-data-ab12" &&
      output.gcp["prod"].bucket == "aikido-demo-prod-data-cd34" &&
      output.gcp["dev"].registry == "europe-west3-docker.pkg.dev/aikido-demo-dev-ab12/aikido-demo" &&
      output.gcp["prod"].registry == "europe-west3-docker.pkg.dev/aikido-demo-prod-cd34/aikido-demo"
    )
    error_message = "root output gcp must map env => project_id, bucket, registry"
  }
  assert {
    condition = alltrue([
      for k in ["project_id", "bucket", "registry"] :
      replace(replace(output.gcp["dev"][k], "-dev-", "-ENV-"), "ab12", "HEX") == replace(replace(output.gcp["prod"][k], "-prod-", "-ENV-"), "cd34", "HEX")
    ])
    error_message = "dev and prod must differ only in env name and suffix"
  }
  assert {
    condition = (
      output.gcp["dev"].internal_vm_name == null && output.gcp["dev"].internal_vm_ip == null &&
      output.gcp["prod"].internal_vm_name == "aikido-demo-prod-files-app-internal"
    )
    error_message = "root output gcp: internal VM in prod only"
  }
}
