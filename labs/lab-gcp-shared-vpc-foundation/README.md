# A Shared-VPC landing zone, with the guardrails proven, not assumed

Most "Shared VPC" tutorials stop at `google_compute_shared_vpc_host_project`
and call it a day. The interesting part of a landing zone isn't that you
*can* centralize a network — it's what that centralization is supposed to
guarantee: that a service team can run its own workloads without ever being
able to touch networking, that traffic in and out of the org crosses a
boundary the network team controls, and that none of this is a suggestion.

This lab builds a miniature version of that landing zone — one Shared-VPC
host project and two service projects — and then tries to break it. A
scripted verifier logs in as each project's service account and attempts
five things a well-run landing zone should refuse or allow in a very
specific way: creating firewall rules outside the host project, launching a
VM in someone else's project, attaching a VM to a subnet it wasn't granted,
reaching the internet before the edge is configured to allow it, and
reaching the internet directly instead of through the egress proxy. Every
proof is a real API call against real GCP resources — no mocks, no
config-only assertions.

Ingress is a global external Application Load Balancer with Cloud Armor in
front of it, both owned by the host project even though the backends are
VMs living in the service projects. Egress is a Secure Web Proxy, also
host-owned, that only lets traffic out to a domain allowlist. Both halves
of the perimeter are controlled centrally; nothing a service project does
can widen either one.

```
organization
│
├── folder: networking
│   └── project: svpc-host-<suffix>            (Shared VPC host)
│       ├── VPC: svpc
│       │   ├── snet-host        10.10.0.0/24  (host resources, incl. SWP IP)
│       │   ├── snet-service-a   10.10.1.0/24  (networkUser: sa-service-a, not sa-service-b)
│       │   ├── snet-service-b   10.10.2.0/24  (networkUser: sa-service-b, not sa-service-a)
│       │   └── snet-proxy-only  10.10.4.0/23  (REGIONAL_MANAGED_PROXY, for the ALB)
│       ├── Global external ALB + Cloud Armor (edge-allowlist policy)
│       │   └── hybrid NEGs → VM IPs in the service projects
│       └── Secure Web Proxy (swp, TCP 443 on the host subnet)
│
└── folder: workloads
    ├── project: svpc-service-a-<suffix>       (service project A)
    │   └── vm-service-a  (10.10.1.10, attached to snet-service-a)
    └── project: svpc-service-b-<suffix>       (service project B)
        └── vm-service-b  (10.10.2.10, attached to snet-service-b)

data paths:
  client  --80--> [ALB + Cloud Armor, host project] --hybrid NEG--> vm-service-a / vm-service-b
  vm-service-a/b  --443--> [Secure Web Proxy, host project] --allowlisted domains only--> internet
```

## The five proofs

A verifier impersonates the lab's service accounts and drives the GCP APIs
directly. Every row below is a real attempt, not a policy read:

| Proof | What is attempted | Expected outcome | Control that enforces it |
|---|---|---|---|
| Network authority | The host service account creates and deletes a firewall rule on the shared VPC; service-A's service account then attempts the same insert | Host SA: allowed both times. Service-A SA: denied (`PERMISSION_DENIED`) | Only the host project's service account holds `compute.networkAdmin`/`securityAdmin` on the host project — the whole point of a Shared VPC host |
| Cross-project workload isolation | Service-A's service account attempts to create a VM in service project B | Denied | Service-A's IAM roles are scoped to its own project only |
| Subnet-level borrowing | Service-A's service account attempts to create a VM in its *own* project, attached to service B's subnet | Denied | `google_compute_subnetwork_iam_member` grants `roles/compute.networkUser` on `snet-service-a` to service-A's SA only — not on `snet-service-b` |
| Ingress allowlist | HTTP requests to the load balancer's IP at `/a` and `/b` | `403` from Cloud Armor while the allowlist is empty; `200` from both paths, serving the matching VM's page, once the runner's IP is allowlisted | The `edge-allowlist` Cloud Armor security policy attached to the backend service — default-deny with an explicit allow list |
| Egress allowlist | From inside a VM: direct HTTPS to `github.com`, then the same request through the Secure Web Proxy, then a request to `example.com` through the proxy | Direct request fails (default-deny egress); proxied request to `github.com` succeeds; proxied request to `example.com` fails | The default-deny egress firewall plus the Secure Web Proxy's domain allowlist |

## Design notes

**Six staged Terraform roots, not one.** `terraform/01_foundation/` through
`terraform/06_workloads/` apply in order, each stage reading the previous
one's outputs through a `terraform_remote_state` data source pointed at a
local backend (`../NN_stage/terraform.tfstate`). A single root would apply
faster, but it would also hide the layering that *is* the lesson: folders
and projects, then IAM, then the shared network, then ingress, then egress,
then the workloads that exercise all of it. Each stage is independently
apply-able and destroyable, and `scripts/deploy_cloud.sh --stage <dir>`
exists specifically so you can walk through one layer at a time instead of
only ever running the whole stack at once.

**Hybrid NEGs, not a managed instance group.** The load balancer's backends
are `NON_GCP_PRIVATE_IP_PORT` network endpoint groups pointing at the
service projects' VM IPs, created in the host project. GCP requires a
backend service and its backends to live in the same project, and Cloud
Armor attaches to the backend service — so the only way to keep the entire
ingress plane (backend service, security policy, URL map, forwarding rule)
host-owned while still routing to VMs that live in service projects is to
address those VMs as opaque IP:port endpoints from the host side. The
trade-off is real: the load balancer has no idea it's talking to
`vm-service-a` versus any other host on that IP, and health checks and
routing all operate on IP:port pairs rather than instance identity.

**The verifier runs on Bun.** `bun install --frozen-lockfile` and
`bun src/index.ts` do double duty as the runtime for the proof scripts and
the test runner (`bun test`) — one fast startup, one lockfile, no separate
`ts-node`/`jest` toolchain, which is a deliberate departure from this
repo's usual Node.js default. Nothing about the proofs depends on a
Bun-specific API; the choice is purely about keeping a script that spins up
IAP tunnels and SSHes into two VMs fast to start and simple to run.

## Prerequisites

- A GCP organization you have permission to create folders in, with these
  roles at the organization level: **Folder Admin**, **Project Creator**,
  **Billing Account User**, and **Shared VPC Admin**.
- A billing account the projects can be attached to.
- `terraform`, pinned to exactly **1.14.8** (every stage's
  `required_version` enforces this).
- `bun` (runs the verifier).
- `curl` (used by `scripts/verify.sh` to detect your runner's public IP for
  the ingress allowlist).
- `gcloud`, authenticated twice: `gcloud auth login` (your user
  credentials, used to open the IAP tunnels to the VMs) and
  `gcloud auth application-default login` (Application Default Credentials,
  used by the verifier's GCP client libraries to impersonate the lab's
  service accounts).
- `jq` (merges Terraform outputs into the verifier's config file).
- `make`.

### Don't have an organization?

A personal Gmail account never has one — GCP only materializes an
Organization resource for accounts managed under **Cloud Identity** or
**Google Workspace**, and both require a domain you own. There is no way
to create an organization directly, but the free path is straightforward:

1. Own a domain (any registrar; a throwaway domain costs a few dollars a
   year — this is the only money involved).
2. Sign up for [Cloud Identity Free](https://cloud.google.com/identity/docs/set-up-cloud-identity-admin)
   with that domain and verify ownership by adding the TXT record it gives
   you at your DNS provider. This creates a new admin identity like
   `admin@your-domain.tld` — no Workspace subscription, free for up to 50
   users, and it does not touch your domain's website or mail.
3. Sign in to the [Cloud Console](https://console.cloud.google.com) as that
   new user once — the Organization resource for your domain is created
   automatically at first sign-in.
4. As that user (it is the domain's super admin, so it can grant itself
   IAM roles), grant it the four organization-level roles listed above,
   and **Billing Account User** on your billing account. A billing account
   created under a different Google account works too — open its
   permissions in the Billing console and add the new user there.
5. Run both `gcloud auth login` and
   `gcloud auth application-default login` **as the new domain user** —
   the lab's org-level Terraform must run under an identity that belongs
   to the organization. `verifier_principal` in `terraform/02_iam` is then
   `user:admin@your-domain.tld`.

Expect the whole detour to take 30–60 minutes, one time. `gcloud
organizations list` printing your domain is the sign you're ready.

The lab creates three GCP projects (one host, two service) and deletes all
three when you run `make destroy`.

## Configure

Copy each stage's example tfvars file and fill in the values it asks for:

```bash
cp terraform/01_foundation/terraform.tfvars.example terraform/01_foundation/terraform.tfvars
# edit: org_id, billing_account

cp terraform/02_iam/terraform.tfvars.example terraform/02_iam/terraform.tfvars
# edit: verifier_principal = "user:<the account you ran gcloud auth application-default login as>"
```

No other stage takes a tfvars file — `03_network` through `06_workloads`
read everything they need from the earlier stages' Terraform outputs.

## Run

```bash
make deploy    # ~15-25 min; stages apply in order 01 -> 06
make verify    # phase 1 (closed door), edge allowlist apply, phase 2 (all five proofs)
make destroy   # reverse-order teardown 06 -> 01
```

To walk through one layer at a time instead, the per-stage targets are
available directly: `make foundation`, `make iam`, `make network`,
`make ingress`, `make egress`, `make workloads`. To preview a stage without
applying it, call the deploy script directly:

```bash
./scripts/deploy_cloud.sh --stage 03_network --dry-run
```

## What the verifier prints

The verifier logs structured JSON lines, one per operation, via `pino` —
each carrying an `appName` and, once a proof starts, a `proof` field
identifying which one (`network-authority`, `cross-project-workload`,
`subnet-borrowing`, `ingress-denied`/`ingress-allowed`, `egress`). The last
line of each phase is a summary carrying `passedCount` and `failedCount`
across every proof result in that phase. Each phase process exits non-zero
if its own `failedCount` is above zero, and `scripts/verify.sh` runs with
`set -euo pipefail`, so `make verify` as a whole exits `0` only when both
phases' summaries show `failedCount: 0` — meaning every one of the five
proofs held.

## Cost and cleanup

A full `make deploy` → `make verify` → `make destroy` cycle costs
single-digit dollars: two `e2-micro` VMs, one global external ALB with
Cloud Armor, and one Secure Web Proxy gateway, all billed for the run's
duration only. `make destroy` tears down all six stages in reverse order,
including the three GCP projects themselves — there is nothing left
running afterward. Each run's projects carry a random hex suffix
(`svpc-host-<suffix>`, etc.), so a re-run never collides with a
soft-deleted project from a previous one.
