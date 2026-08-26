# Surviving a bad migration: an automated disaster-recovery drill on Cloud SQL for PostgreSQL

A migration that quietly corrupts data and then commits cannot be rolled
back — there is no `ROLLBACK` for a transaction that already succeeded, and
by the time anyone notices, every subsequent write has been built on top of
the bad data. The only thing left to do is detect the corruption, restore
from a backup taken before it happened, and prove — not assume — that the
restore actually worked. This lab rehearses exactly that sequence end to
end, with no human in the loop: it provisions a real Cloud SQL for
PostgreSQL instance, seeds it with known-good data, ships a migration with a
deliberately silent bug, catches the damage with an invariant check,
triggers an automatic restore from an on-demand backup, and then proves —
by comparing table checksums, not by assuming the restore worked — that the
restored data is identical to the pre-migration baseline.

## What the drill does

The drill runs as a single Node.js process (`npm run drill`) against a
Cloud SQL instance that Terraform has already provisioned. It moves through
six stages:

1. **Seed** — creates the `orders` and `control_totals` tables and inserts
   500 generated orders, along with a `control_totals` row recording the
   grand total in cents before anything can go wrong.
2. **Checksum + backup** — computes a checksum per table over the
   known-good data, then requests an on-demand Cloud SQL backup and polls
   the Cloud SQL Admin API until the backup run reports `SUCCESSFUL`.
3. **Faulty migration** — applies a "cents to euros" migration that
   converts `unit_price_cents` and `total_cents` to `numeric(10,2)` columns
   using integer division (`/ 100` instead of `/ 100.0`). Every statement
   commits; there is no error, no warning — just silently truncated
   amounts.
4. **Invariant check** — re-derives the same checksums and runs two SQL
   checks: a row-level check that `total = quantity * unit_price` still
   holds for every order, and a ledger-level check that the sum of order
   totals still matches the `control_totals` row recorded before the
   migration. Both fail, reporting the number of corrupted rows and the
   grand-total drift in cents.
5. **Automatic restore** — because the invariant failed, the drill closes
   its own database connection and calls the Cloud SQL Admin API to restore
   the instance in place from the backup taken in stage 2, then waits for
   the instance to report `RUNNABLE` again and reconnects with retries
   (a freshly restored instance is briefly unreachable even after it
   reports `RUNNABLE`).
6. **Checksum proof** — recomputes the table checksums on the restored
   instance and compares them against the stage-2 baseline. The drill only
   exits `0` if every table's checksum after restore matches the
   pre-migration baseline exactly; the post-corruption checksums, by
   contrast, are expected to differ.

Everything after `terraform apply` runs from your machine against the
instance over its public IP and the Cloud SQL Admin API:

```
+----------------------------+                              +----------------------------+
|        Your laptop         |       public IP :5432        |   Cloud SQL for Postgres   |
|                            |  ------------------------->  |     (single instance)      |
| terraform apply/destroy    |                              |                            |
| npm run drill              |     Cloud SQL Admin API      | - the Postgres database    |
|  (seed / migrate / check)  |  ------------------------->  | - backup runs              |
+----------------------------+                              | - restore in place         |
                                                            +----------------------------+
```

## What you'll learn

- Why a committed, silently corrupting migration is a **recovery** problem,
  not a rollback problem — and why "just revert the migration" doesn't undo
  the damage once bad writes have landed on top of it.
- The difference between on-demand backups and point-in-time recovery in
  terms of recovery point objective (RPO): an on-demand backup only
  protects data as of the moment it was taken, so the drill takes one
  immediately before the risky change, not on a schedule.
- Why a restore has to be **proven**, not trusted: Cloud SQL reporting the
  instance `RUNNABLE` again tells you the restore operation finished, not
  that the data it recovered is actually correct. The drill only calls the
  recovery successful once checksums confirm the restored tables are
  identical to the pre-migration baseline.

## Prerequisites

- A GCP project with billing enabled.
- The `gcloud` CLI, authenticated twice: `gcloud auth login` for your user
  credentials, and `gcloud auth application-default login` for Application
  Default Credentials (ADC) — the Node.js drill runner uses ADC to call the
  Cloud SQL Admin API.
- Terraform, pinned to exactly `1.14.8` (the version this lab's
  configuration requires).
- Node.js 22 or later.

## Cost and time

The full run takes roughly 30–45 minutes end to end, dominated by Cloud SQL
instance provisioning, the on-demand backup, and the in-place restore — not
by the drill logic itself, which runs in seconds. At the default
`db-f1-micro` tier, the whole exercise costs well under $1 as long as you
destroy the instance afterward with the last command below.

## Run it

```bash
cd terraform && cp terraform.tfvars.example terraform.tfvars   # fill in project_id + your IP
cd .. && ./scripts/deploy_cloud.sh                             # ~10-20 min
./scripts/generate_env.sh
npm install
npm run drill                                                  # ~15-30 min
./scripts/deploy_cloud.sh --destroy
```

`terraform.tfvars` needs at least `project_id` and `authorized_cidr` (your
public IP in CIDR notation, e.g. `203.0.113.7/32` — `curl -4 -s ifconfig.me`
will print it); region, tier, Postgres version, database name, and database
user all have working defaults and only need overriding if you want
something different. `./scripts/deploy_cloud.sh` runs `terraform init` and
`terraform apply -auto-approve`; pass `--dry-run` first if you'd rather
review the plan, and `--destroy` (as in the last line above) to tear
everything down once you're done. `./scripts/generate_env.sh` reads the
Terraform outputs and writes a gitignored `.env` file the drill runner
loads at startup.

## Reading the output

The drill runner logs structured JSON lines (via `pino`) to stdout, one
event per stage transition, tagged with `"appName":"postgres-dr-drill"`.
Watching them in order should show:

- `Running the disaster-recovery drill...` — logged once at the very
  start; everything below happens between this line and the matching
  `succeeded.` / `failed.` line at the end.
- `Connecting to Postgres...` / `succeeded` — the runner's first connection
  to the freshly provisioned instance.
- `Seeding the database...` / `succeeded` — with `orderCount: 500`.
- `Computing table checksums...` / `succeeded` — the pre-migration
  baseline.
- `Creating on-demand backup...`, then a `Waiting for operation...` /
  `... succeeded.` pair while the Cloud SQL Admin API backup operation
  runs, then `Creating on-demand backup succeeded.` — with the
  `backupRunId` the restore step will use later.
- `Applying the faulty migration...` / `succeeded` — the migration commits
  cleanly; nothing here reports an error.
- `Computing table checksums...` / `succeeded` again, right after the
  migration — this is the evidence that the corrupted state measurably
  differs from the baseline; the `orders` checksum will not match the
  previous pair (`control_totals` is only read, never modified, by the
  migration, so its checksum stays the same).
- `Checking post-migration invariants...` / `succeeded` — with
  `corruptedRows` and `grandTotalDriftCents` both **non-zero**, confirming
  the migration actually corrupted data (a run where both are zero aborts
  early, since there would be nothing to recover from).
- `Invariant violated; triggering automatic restore...` (a warning) — the
  pivot point where the runner decides to recover on its own.
- `Restoring instance from backup...`, then a `Waiting for operation...` /
  `... succeeded.` pair while the restore operation runs, then
  `Restoring instance from backup succeeded.`, followed by
  `Waiting for instance to be RUNNABLE...` / `succeeded`.
- Possibly one or more rounds of `Connecting to Postgres...` /
  `Connecting to Postgres failed.` / `Connecting to Postgres failed;
  retrying...` (a warning) before a `Connecting to Postgres...` /
  succeeded pair goes through — a freshly restored instance can take a
  little while to accept connections again even after it reports
  `RUNNABLE`, though a run that waits out a long restore may well
  reconnect on the first try.
- `Computing table checksums...` / `succeeded` again, on the restored
  instance — compared against the baseline for the final proof.
- `Running the disaster-recovery drill succeeded.` — the final line, with
  `tablesVerified: ["control_totals","orders"]` and the same
  `corruptedRows` / `grandTotalDriftCents` figures from the invariant
  check. The process exits `0` only if the restored checksums matched the
  pre-migration baseline for every table; if they didn't, or any stage
  threw, you'll see `Running the disaster-recovery drill failed.` and a
  non-zero exit code instead.

## Notes

The drill's database user authenticates with a password (generated by
Terraform's `random_password` resource), which is a deliberate departure
from this repo's usual keys-only habit for cloud resources. Cloud SQL
application users are password-authenticated by design; there's no
equivalent to an SSH keypair here. The password never leaves generated
Terraform state and the gitignored `.env` file `generate_env.sh` writes,
and it stops existing the moment you destroy the instance.

The Cloud SQL instance name carries a random hex suffix
(`postgres-dr-drill-<hex>`) rather than a fixed name, because Cloud SQL
reserves a deleted instance's name for about a week — a fixed name would
make re-running this lab shortly after a previous `--destroy` fail with a
naming conflict.

The drill's connection to Postgres is TLS-encrypted, but the client does
not verify the server certificate (`rejectUnauthorized: false`) — fine for
a disposable lab instance, but a production setup should verify against
the instance's CA cert instead.

## Troubleshooting

- **ADC quota-project warning** — if `gcloud` or the drill runner warns
  about a missing quota project for Application Default Credentials, run
  `gcloud auth application-default set-quota-project <project>` once for
  your project.
- **Connection refused when the drill tries to connect** — your public IP
  likely changed since you set `authorized_cidr`. Re-check it against
  `curl -4 -s ifconfig.me` and update `terraform.tfvars`, then re-apply.
- **Re-running `npm run drill`** — safe to do as many times as you like.
  The seed stage drops and recreates `orders` and `control_totals` on every
  run, so each run starts from the same known-good state.
