# Vertex AI Search: Google Drive as a Living Corpus

Terraform provisions a Vertex AI Search data store and search app. A
TypeScript CLI seeds a Google Drive shared drive with a small corpus of
Google Docs, walks that drive, exports each Doc to Markdown, and imports it
into the data store. Then it proves the sync loop actually works: edit a
Doc, re-sync, and the answer changes; move a folder, re-sync, and the
moved documents leave the index without going stale.

## 1. What this shows

Vertex AI Search normally indexes a static snapshot: you upload some
files, they get chunked and embedded, and the index sits there until you
upload again. This lab treats Google Drive as a *living* corpus instead —
the source of truth keeps changing after the first sync, and the sync
loop (`npm run sync`) is what a reader would run on a schedule or after an
edit to keep the index caught up.

The CLI walks a shared drive, exports every Google Doc it finds as
Markdown, stages the exports in Cloud Storage, and imports them into the
data store using the Drive file ID as the document ID. That last detail
matters: because the document ID is stable across edits, editing a Doc's
content updates the same indexed document instead of creating a new one,
and moving a Doc between folders doesn't touch its ID at all.

Two proofs back that up, both automated by `npm run verify`:

- **Freshness** — change a number inside a Doc, re-sync, and ask a
  question whose answer depends on that number. The old value is gone and
  the new one is grounded and cited, with the same document ID before and
  after.
- **The move trap** — move a subfolder from the live corpus into an
  archive folder, re-sync, and its documents disappear from the index
  entirely — not because Vertex AI Search understands "archive," but
  because the sync walk starts at the corpus root and a folder outside
  that root is simply never visited. The Drive changes feed sees this
  differently than you might expect (more on that in
  [section 6](#6-watching-it-work-by-hand)), which is exactly why it's
  worth watching by hand once.

## 2. Why not the managed Drive connector

Vertex AI Search ships a first-party Google Drive connector, and it would
be the obvious first choice for this. Three things about it ruled it out
for a lab meant to be watched, not just deployed:

The managed connector's incremental sync runs on a fixed schedule with a
floor around three hours, and there's no button or API call to trigger a
sync on demand. A lab is meant to be run and watched in the same sitting —
waiting up to three hours to see an edit land defeats the point.

Setting it up is console-only. There's no Terraform resource and no
`gcloud` command for it, which breaks this repo's convention that every
lab deploys from a single script and leaves nothing to be clicked through
by hand.

Folder scoping was removed for new Drive data stores: Google's current
guidance is that a Drive connector data store indexes an entire shared
drive (or "My Drive"), not a chosen subfolder. This lab needs the corpus
and the archive folder to sit side by side in one shared drive so the move
test has somewhere to move a folder *to* without also indexing it — the
managed connector doesn't give you that boundary.

Writing the sync loop by hand — walk the tree, export, stage, import — is
the tradeoff this lab makes instead: slower to build, but on-demand,
scriptable, and scoped to exactly the folder it should index.

## 3. Prerequisites

- A GCP project with billing enabled and `gcloud` set up with Application
  Default Credentials (`gcloud auth application-default login`).
- Node.js >= 22.
- A Google Workspace tenant on an edition where shared drives exist —
  **Business Standard and above**. Business Starter cannot create shared
  drives at all, and this lab needs a shared drive specifically, not a
  folder in someone's My Drive: a service account has no storage quota
  of its own and cannot own files, so it can only create and hold
  documents inside a shared drive, where the organization — not any
  individual, and not the service account — owns everything in it. A
  custom domain on that tenant is not required.
- Domain-admin ability to change two sharing settings, from the Google
  Admin console under Apps → Google Workspace → Drive and Docs → Sharing
  settings:
  - **"Allow users outside your organization to access files in shared
    drives"** must be turned on. This sounds like it's about human
    guests, but it also governs the service account: every service
    account's address ends in `.iam.gserviceaccount.com`, which makes it
    external to every Workspace domain by definition, including one
    created inside the very same organization.
  - If the domain further restricts external sharing to an allowlist of
    domains, add `gserviceaccount.com` to that allowlist. Without it, the
    setting above is on but service accounts still get bounced.

One fact worth stating plainly because it shapes the whole lab: **the GCP
project and the Workspace tenant can belong to completely unrelated
organizations.** There's no domain-wide delegation to configure and no
OAuth client to register and trust on the Workspace side. The only thing
that connects them is that a human with access to the shared drive adds
the service account's email address to it, the same way you'd share a
folder with a contractor. No IAM role of any kind grants access to Drive
content — the Drive share itself *is* the grant.

## 4. Setup

```bash
cd labs/lab-vertex-ai-search-gdrive-sync
cp terraform/terraform.tfvars.example terraform/terraform.tfvars
# set project_id in terraform/terraform.tfvars
```

One-time bootstrap, only needed the first time you use a given project —
Terraform needs the API that lets it enable APIs before it can enable
anything else:

```bash
gcloud services enable cloudresourcemanager.googleapis.com serviceusage.googleapis.com --project <your-project-id>
gcloud auth application-default set-quota-project <your-project-id>
```

Skip either of these and `terraform apply` fails partway through, or ADC
calls fail with a missing quota project.

In Drive, create a shared drive — not a My Drive folder, for the reason
given in [section 3](#3-prerequisites) — and copy its ID out of the URL:

```
https://drive.google.com/drive/folders/<this-part-is-drive_id>
```

Put that in `terraform.tfvars` as `drive_id`, then deploy:

```bash
./scripts/deploy_cloud.sh
```

This provisions the staging bucket, the data store, the search app, and a
service account, and writes `cli/.env` for you (`terraform/09_cli_env.tf`)
— nothing to copy by hand between Terraform and the CLI. Take note of the
`sync_service_account` output; you need it for the next step.

In the Drive web UI, open the shared drive's member settings and add that
service account's email address as **Content manager**. Not Editor.
Drive's own UI calls the Editor role "Contributor" once you're inside a
shared drive's permission list, and Contributor cannot move a file or
folder between locations in a shared drive — it can create and edit
content but not relocate it. The verification suite moves a subfolder as
part of proving the sync loop keeps up, and if the service account is
only a Contributor that move silently fails validation later, in a way
that has nothing to do with anything you're likely to be looking at.
Content manager is the lowest shared-drive role that includes move.

```bash
cd cli
npm install
npm run seed
npm run sync
npm run verify
```

One thing to know before that first `npm run seed`: it uploads each
corpus document as `text/markdown` media when creating the Google Doc,
relying on Drive's own import conversion to turn that into a native Doc
(`cli/src/drive/seed.ts`). Google's own documentation is not fully
consistent about whether Markdown is an importable source format for
Google Docs at all — some pages list it, others don't. This lab takes the
`text/markdown` branch as a working assumption rather than a verified
fact; the first real `npm run seed` against a live project is what
actually confirms or refutes it. If Drive rejects that MIME type, or
imports it as plain text instead of a formatted Doc, that's a bug in
`SEED_MIME_TYPE` (`cli/src/drive/seed.ts`) to fix, not a sign you did the
setup wrong.

## 5. The three identities

Three separate identities do the work here, and none of them overlaps
with another:

| Identity | Used for | Where |
|---|---|---|
| Your GCP user (Application Default Credentials) | `terraform apply`/`destroy`, minting short-lived tokens for the service account (`roles/iam.serviceAccountTokenCreator`, granted in `terraform/05_service_account.tf`) | Terminal |
| `corpus-sync` service account (`SYNC_SERVICE_ACCOUNT` in `cli/.env`) | The Drive principal — the only identity that ever calls the Drive or Docs APIs | Impersonated by the CLI, never given a key file |
| Your Workspace user | Adding the service account to the shared drive as Content manager; optionally editing a Doc by hand in [section 6](#6-watching-it-work-by-hand) | Browser only |

The service account holds no project IAM role beyond being impersonable —
`terraform/05_service_account.tf` says so directly: "no IAM role of any
kind grants access to Drive content." Its only access to anything in
Drive comes from Drive membership, which is a Workspace-side grant, not a
GCP-side one. The CLI never writes a key file for it; instead your ADC
calls `generateAccessToken` through `Impersonated` in
`cli/src/drive/auth.ts` and gets back a token scoped to exactly what the
calling command needs, valid for an hour.

That last point is a real security property, not an implementation
detail: **the sync path holds read-only Drive credentials.**
`npm run sync` and `npm run changes` request only
`drive.readonly` (`DRIVE_READONLY_SCOPE` in `cli/src/drive/auth.ts`). The
broader `drive` write scope is requested only by `npm run seed` — which
has to create folders and Docs — and by the verification suite, which
requests it because two of its three stages deliberately mutate the
corpus (editing a Doc's text, moving a folder) to prove the sync loop
reacts. If you only ever ran `npm run sync` in production, that process
could not write, delete, or move a single file in Drive even if it were
compromised.

## 6. Watching it work by hand

The automated `verify` suite proves the sync loop works, but seeing it
happen is more convincing than reading an assertion list. With the corpus
seeded and synced:

1. Open any document in the shared drive's `corpus/` folder in Google
   Docs and change its "Benchmark note" figure to something else.
2. Run `npm run sync`. It re-walks the tree, re-exports every Doc, and
   reports how many documents changed.
3. Run `npm run ask "<the question that document answers>"`. The old
   number should be gone from the answer and the new one should be there,
   still cited to the same document.

Then run `npm run changes`. It prints the Drive changes feed since the
last time you asked it — a raw look at what Drive itself thinks moved,
independent of anything the sync tooling inferred. This is worth doing
right after the move stage of `verify` runs (or after moving a folder
yourself), because the feed's behavior is easy to get wrong intuitively:
**the changes feed reports the moved folder itself, but says nothing
about the files that were inside it.** Drive's change events are keyed to
the object whose parents actually changed — the folder — not to
everything nested underneath, even though the sync tooling's own walk
absolutely does need to know those files' index entries are now stale.
That gap between "what Drive tells you changed" and "what your index
needs to know changed" is the whole reason this lab treats a full
re-walk, not the changes feed, as the sync engine — see
[section 9](#9-whats-deliberately-missing).

## 7. What the verification proves

`npm run verify` reads the manifest written by the last `npm run sync`,
then runs three stages, printing a `PASS`/`FAIL` line per check
(`cli/src/commands/verify.ts`) and exiting non-zero if anything failed:

**Baseline** (`cli/src/verify/baseline.ts`) — the tree landed correctly
and retrieval is doing the work, not the model's pretraining:
- every synced document is indexed, and the indexed IDs are exactly the
  Drive file IDs from the manifest (no more, no fewer);
- for each of the ten corpus documents, asking the question tied to its
  invented benchmark figure returns an answer that contains that figure,
  cites that document's staged object, and comes back with a grounding
  score above the configured threshold (`GROUNDING_THRESHOLD`, default
  `0.6`) — a grounded answer can legitimately draw on more than one
  document, so this checks that the citation is present, not that it's the
  only one;
- asking those same ten questions again with retrieval disabled does
  *not* produce the invented figure — because it's invented, the only way
  it can appear in an answer is if it was actually retrieved.

**Freshness** (`cli/src/verify/freshness.ts`) — an edit lands without
changing the document's identity: it replaces the benchmark figure inside
one Doc, re-syncs incrementally, and checks that the new figure is
answerable, the old figure is gone, the citation still points at the same
document, and the document's Drive file ID is unchanged across the edit.
It restores the original text afterward — in a `finally`, so a failed
check midway still leaves the corpus as it found it — and re-syncs again
so the restore takes effect immediately rather than surprising the next
run.

**The move trap** (`cli/src/verify/move.ts`) — moving the `evaluation/`
subfolder out of the corpus and into the archive folder, then re-syncing
with a full rebase, checks that its documents left the index, that the
index shrank by exactly that many documents, that the changes feed
reported the folder itself, and that the changes feed reported nothing
about the files inside it (the gap described in
[section 6](#6-watching-it-work-by-hand)). It then moves the folder back
and re-syncs again, checking every document came back — also inside a
`finally`, for the same reason.

A verify run that only passes once isn't proof of anything durable; both
mutation stages restore what they changed, which is why `npm run seed`
and `npm run sync` should report nothing new to do on a second run right
after `verify` finishes.

## 8. Costs and teardown

Expect well under $1 for a full run. Vertex AI Search's free tier covers
far more queries than this lab's seed/sync/verify cycle uses, the corpus
is a handful of short Markdown files, and the Cloud Storage bucket holds
only their staged exports.

One thing that can look like a leak but isn't: every `npm run sync`
writes a staged object per document and never deletes one for a document
that has since left Drive, so the bucket can accumulate objects nothing
points at anymore. This is harmless — the metadata JSONL written
alongside them is what actually tells the data store what to import, so a
stale object is just inert — but it can surprise anyone who looks in the
bucket directly. `force_destroy` on the bucket
(`terraform/06_bucket.tf`) means none of it lingers past teardown either
way.

```bash
./scripts/deploy_cloud.sh --destroy
```

This tears down the bucket, the data store, the search app and the
service account. It does **not** touch the shared drive — Terraform never
owned it, only a `drive_id` pointing at it — so the `corpus/` and
`archive/` folders and their Docs are still sitting in Drive afterward.
Delete that content by hand if you're done with it.

One timing quirk to plan around: **a destroyed data store keeps its ID
reserved for hours afterward.** Redeploying into the same project right
after a destroy, with the same `resource_prefix`, fails with something
like "DataStore ... is being deleted, please wait for deletion to
complete before recreating with the same ID." Either wait it out, or set
a new `resource_prefix` in `terraform.tfvars` before the next
`./scripts/deploy_cloud.sh` — that renames the bucket, data store,
search app and service account together, so the redeploy doesn't collide
with anything still being torn down.

## 9. What's deliberately missing

This lab is scoped to one thing — proving a Drive-backed sync loop stays
correct across edits and moves — not to a tour of everything Vertex AI
Search can do. Left out on purpose:

- **Custom metadata and filtered search** — every document goes in as
  plain content with no structured fields attached, so there's no
  faceted or filtered search here.
- **ACL-aware search with end-user credentials** — this lab's search app
  answers with the same visibility for everyone who calls it; there's no
  per-user permission check layered on top of what's indexed.
- **The managed Drive connector** — ruled out in
  [section 2](#2-why-not-the-managed-drive-connector); this lab hand-rolls
  the sync loop instead.
- **PDFs or any non-Markdown format** — the corpus is Google Docs,
  exported to Markdown. Nothing here exercises Vertex AI Search's other
  document parsers.
- **A second, changes-feed-driven sync engine** — `npm run changes` reads
  the Drive changes feed and prints it, but nothing in this lab acts on
  it. Building an incremental sync engine on top of `changes.list`
  instead of a full tree walk is a real follow-up project, not something
  this lab attempts — not least because of the gap in section 6, where
  the feed doesn't tell you about files inside a moved folder.
