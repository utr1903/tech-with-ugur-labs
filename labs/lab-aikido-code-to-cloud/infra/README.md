# infra

Terraform root for the deliberately vulnerable Aikido demo environment: AWS (`eu-central-1`, via `modules/aws-env`) plus two GCP projects (`europe-west3`, via `modules/gcp-env`). Local state.

> **Deliberately insecure.** The resources are misconfigured on purpose, and each flaw carries an `# INSECURE-BY-DESIGN:` comment. Fake data only. Short-lived. Do not reuse any of this.

The normal way to deploy and tear down is `make deploy` / `make destroy` from the lab folder. The manual commands below are for working on the infrastructure itself.

## What is created

One convention everywhere: every directory (the root and each module) holds numbered `.tf` files. `00` is versions or main (providers), `01` variables, `99` outputs, and the numbers in between follow dependency order: a file only references files with lower numbers.

The root only wires modules together; all resources live in the two modules.

Root (`infra/`):

| File | Contents |
|---|---|
| `00_main.tf` | Terraform and provider pins, AWS and Google providers |
| `01_variables.tf` | All inputs |
| `02_aws.tf` | Instantiates `modules/aws-env` (single instance) |
| `03_gcp.tf` | Instantiates `modules/gcp-env` once per entry in `gcp_envs` (dev, prod) |
| `99_outputs.tf` | Outputs consumed by the scripts, read from `module.aws` and `module.gcp` |

`modules/aws-env/`:

| File | Contents |
|---|---|
| `00_versions.tf` | AWS provider requirement (the provider itself is configured in the root) |
| `01_variables.tf` | AWS inputs |
| `02_locals.tf` | Derived names and the AZ slice |
| `03_data.tf` | AZs, caller identity, partition, region, session context |
| `04_vpc.tf` | VPC, 2 public subnets, internet gateway, routes, default security group |
| `05_eks.tf` | EKS cluster and node IAM roles, cluster, deployer access entry, managed node group, add-ons (needs the VPC) |
| `06_s3.tf` | S3 data bucket and public access block |
| `07_ecr.tf` | ECR repository for the chatbot image |
| `08_app_iam.tf` | Over-privileged chatbot IAM role and EKS Pod Identity association (needs the cluster) |
| `09_aikido_cspm.tf` | Aikido read-only IAM role for cloud posture (CSPM) scanning (correctly configured, not a flaw) |
| `10_aikido_vm.tf` | Aikido EBS snapshot role for VM scanning, translated from the wizard's CloudFormation template (not a flaw) |
| `11_aikido_ecr.tf` | Aikido ECR read-only role for container image scanning (not a flaw) |
| `99_outputs.tf` | AWS outputs |

`modules/gcp-env/`:

| File | Contents |
|---|---|
| `00_versions.tf` | Provider requirements |
| `01_variables.tf` | Per-environment inputs |
| `02_project.tf` | Project, APIs, org policy overrides |
| `03_network.tf` | Network and firewall |
| `04_storage.tf` | GCS bucket and Artifact Registry |
| `05_vm.tf` | VM and its service account (`startup.sh.tftpl` is its startup script) |
| `06_aikido.tf` | Aikido service accounts, keys and VM scanner binding |
| `99_outputs.tf` | Per-environment outputs |

## GCP module

`modules/gcp-env` creates one environment: a project `aikido-demo-<env>-<hex>` (under the org, with billing), the enabled APIs, a network and firewall, a GCS bucket, an Artifact Registry repository, an e2-small VM on an old Debian 12 image running the `gcp-files` container (a systemd unit that keeps retrying until the image is pushed), and the Aikido service accounts, their keys and the VM scanner binding. GCP VM scanning roles are granted to `aikido-vm-scanner@aikido-vm-scanning.iam.gserviceaccount.com` (the Aikido-managed account from the wizard); `aikido-vm-scanner-batch@…` is only the VPC Service Controls principal.

Three org policies are overridden on the two lab projects only (never on the organization): `iam.allowedPolicyMemberDomains` (incl. Aikido's customer id `C016qe815`), `iam.managed.disableServiceAccountKeyCreation` and `storage.uniformBucketLevelAccess`. A `time_sleep` (90 s) lets them propagate before the dependent resources are created; if the first apply still fails with a constraint violation, rerun it. Applying needs `gcloud auth application-default login` and `roles/orgpolicy.policyAdmin` on your organization (`gcp_org_id` in `terraform.tfvars`):

```bash
gcloud organizations add-iam-policy-binding <gcp_org_id> \
  --member=user:<you> --role=roles/orgpolicy.policyAdmin
```

Outputs: `gcp` (per env: `project_id`, `vm_ip`, `bucket`, `registry`) and the sensitive `gcp_aikido_keys` (base64 service account keys, read by `deploy.sh`).

Aikido's VM scanning for GCP, deleting a VM-scanning cloud and removing the Artifact Registry registries are UI-only, see [`../README.md`](../README.md#manual-steps-in-the-aikido-ui).

## Variables

| Name | Default | Purpose |
|---|---|---|
| `region` | `eu-central-1` | AWS region |
| `name_prefix` | `aikido-demo` | Prefix for all resource names |
| `vpc_cidr` | `10.0.0.0/16` | VPC CIDR block |
| `kubernetes_version` | `1.37` | EKS Kubernetes version |
| `node_instance_type` | `t3.medium` | Node group instance type |
| `node_count` | `2` | Number of nodes |
| `app_namespace` | `chatbot` | Kubernetes namespace of the app (pod identity) |
| `app_service_account` | `chatbot-server` | Kubernetes service account of the app (pod identity) |
| `aikido_principal_arn` | Aikido's findings role | Principal allowed to assume the read-only role |
| `aikido_vm_principal_arn` | Aikido's EBS scanner role | Principal allowed to assume the VM scanner role |
| `aikido_ecr_principal_arn` | Aikido's container image scanner role | Principal allowed to assume the ECR read-only role |
| `aikido_external_id` | required, `aikido-<workspace id>` | External ID Aikido must present; `deploy.sh` derives it from the Aikido API |

The GCP inputs (`gcp_envs`, `gcp_org_id`, `gcp_billing_account`, `gcp_region`, `gcp_zone`, `gcp_own_customer_id`, `gcp_aikido_customer_id`) are in the root `01_variables.tf`. `gcp_org_id`, `gcp_billing_account` and `gcp_own_customer_id` are required and come from your `terraform.tfvars` (copy `terraform.tfvars.example`); the others have defaults.

## Registering the VM and ECR roles with Aikido

`deploy.sh` registers only the CSPM role (`POST /clouds/aws`). Aikido's public API has no endpoint for VM scanning or ECR registries, so for now you paste these ARNs into the Aikido UI wizards by hand. All three roles use the same external ID (`aikido-<workspace id>`).

```bash
terraform -chdir=infra output -raw aikido_vm_role_arn
terraform -chdir=infra output -raw aikido_ecr_role_arn
```

**Before tearing down** (`destroy.sh` doesn't know about these integrations): remove the VM and ECR integrations in the Aikido UI first, so Aikido stops scanning before its roles disappear. Then check for EBS snapshots Aikido left behind. They are tagged `aikido_snapshot=true`, not `Project=aikido-demo`, so the `destroy.sh` leftover report misses them, and they keep costing money:

```bash
aws ec2 describe-snapshots --owner-ids self --filters Name=tag:aikido_snapshot,Values=true \
  --query 'Snapshots[].SnapshotId' --output text
```

## Apply and destroy manually

```bash
cd infra
export TF_VAR_aikido_external_id=aikido-<workspace id>   # deploy.sh sets this for you
cp terraform.tfvars.example terraform.tfvars              # once: your GCP organization, billing, customer id
terraform init
terraform apply -auto-approve
terraform output

# kubeconfig (gitignored location; never touches ~/.kube/config)
export KUBECONFIG="$PWD/../.state/kubeconfig"   # from infra/
mkdir -p "$(dirname "$KUBECONFIG")"
aws eks update-kubeconfig --name "$(terraform output -raw cluster_name)" \
  --region "$(terraform output -raw region)" --kubeconfig "$KUBECONFIG"
kubectl get nodes

terraform destroy -auto-approve
```

The S3 bucket (`force_destroy`) and ECR repository (`force_delete`) are removed even when they contain objects or images.

`tests/` holds the plan-mode `.tftest.hcl` files (nothing is created, but the AWS plans read your account, so they need a valid AWS login). Run them from `infra/`:

```bash
terraform fmt -check -recursive && terraform validate && terraform test
```

## Measured durations

Measured on 2026-11-19 from a clean state (31 resources):

| Operation | Duration |
|---|---|
| `terraform apply` | about 9 minutes (8m54s) |
| `terraform destroy` with a dummy S3 object and an ECR image | about 10.5 minutes (10m46s) |
| `terraform destroy` with an empty bucket and registry (final destroy) | about 10.5 minutes (10m25s) |

A second `terraform plan` after the apply reports no changes. After destroy, no `Project=aikido-demo` tagged resources and no `aikido-demo*` IAM roles remain (the tagging API can list a deleted security group for a few minutes).

## Approximate cost while up

About $0.20-0.25 per hour on AWS, plus roughly $1 per day for the two GCP projects: EKS control plane ~$0.10, 2x t3.medium ~$0.10, plus a classic load balancer ~$0.03 once the app is deployed (not part of this root). No NAT gateway. Public IPv4 addresses (~$0.005/h each, for the nodes and the load balancer) and the node EBS volumes are extra. Bedrock is billed per use.

## Bedrock model

The chatbot uses Amazon Nova 2 Lite through inference profile `eu.amazon.nova-2-lite-v1:0`. Amazon's own models need no use-case form or Marketplace agreement. The app's IAM role reaches S3 and Bedrock through EKS Pod Identity (role `aikido-demo-chatbot-server`).
