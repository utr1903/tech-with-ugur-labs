# Vertex AI Search RAG

A fully managed retrieval-augmented generation (RAG) backend on Google Cloud,
built with Terraform, loaded with a small corpus, and proven — not assumed —
to answer from that corpus rather than from the model's own training data.

## What this lab shows

Terraform provisions a Cloud Storage bucket, a Vertex AI Search data store,
and a search app with the LLM add-on enabled. A TypeScript CLI uploads ten
Markdown documents into it, asks it questions, and checks the answers.

The interesting part is *how* it checks. It's easy to ask a RAG system a
question and get a plausible-sounding answer back — that alone proves
nothing, because a large language model can produce plausible-sounding
answers about almost anything without retrieving a single document. To
prove retrieval actually happened, every document in the corpus carries one
invented benchmark figure, made up specifically for this lab and clearly
flagged inside the document as fictional. No model has seen these numbers
during training, because they didn't exist before this lab did. So if you
ask a question that only the corpus can answer, and the number comes back
correctly, cited to the right file, with a grounding score attached — the
answer had to come from retrieval. There's nowhere else it could have come
from.

The lab's verification suite runs that logic as an automated check: ten
positive probes (the canary number comes back, cited, grounded), ten control
probes (the same questions asked with retrieval disabled — the number does
not come back), an abstention probe (a question about something the corpus
doesn't cover), and a cross-document probe (a question that can only be
answered by combining two documents). All 45 checks pass against a live
deployment; see [What `verify` checks](#what-verify-checks) for the observed
numbers.

## What you need

In this order:

1. A GCP project with billing enabled.
2. `gcloud`, [Terraform](https://developer.hashicorp.com/terraform) — the
   Terraform config pins the version exactly (`= 1.14.8` in
   `terraform/00_main.tf`), so install that version — and Node.js >= 22.
3. Application Default Credentials for `gcloud`:

   ```bash
   gcloud auth application-default login
   gcloud auth application-default set-quota-project <your-project-id>
   ```

4. A one-time bootstrap on a brand-new project. Terraform needs the Cloud
   Resource Manager and Service Usage APIs enabled before it can enable
   anything else — including itself:

   ```bash
   gcloud services enable cloudresourcemanager.googleapis.com serviceusage.googleapis.com --project <your-project-id>
   ```

   Skip this and the first `terraform apply` fails with something like
   `Cloud Resource Manager API has not been used in project ... before or
   it is disabled`. Terraform can't enable APIs on your behalf without the
   API that lets it enable APIs.

**Cost:** well under $1 for a full run. Vertex AI Search includes 10,000
free queries per account per month, and this lab's `verify` run uses a
couple dozen of them. The corpus is 40 KB. The data store and search app
don't cost anything beyond the storage they use while they exist — but
they do exist until you delete them, so **you must run the destroy step**
in [Tear it down](#tear-it-down) when you're done.

## The corpus

Ten Markdown documents under `corpus/`, each a few paragraphs on a real RAG
topic: chunking strategies, embeddings, vector indexes, RAG vs. fine-tuning,
retrieval evaluation, hallucination and grounding, reranking, prompt
injection, MLOps for RAG, and feature stores.

Every document ends with a "Benchmark note" that cites one number against a
benchmark with an invented name — `Frostvane-7`, `Halcyon-3`,
`Marrowlight-12`, and so on — followed by an explicit disclaimer inside the
document itself that the benchmark is fictional. These names and numbers do
not exist anywhere else. That's deliberate: the benchmark's *name* is weak
evidence of retrieval, because the question we ask usually contains it too,
so a model could echo it back without looking anything up. The *number* is
the strong evidence — it's the one part of the sentence a model can't
plausibly guess or reword its way into producing, and it appears nowhere
except inside that one document. That's why the verification suite checks
for the bare digits (`41.8`, not `41.8 points`) — units and phrasing are the
model's choice, the digits are not.

## Run it

```bash
cd labs/lab-vertex-ai-search-rag
cp terraform/terraform.tfvars.example terraform/terraform.tfvars
# set project_id in terraform/terraform.tfvars
./scripts/deploy_cloud.sh          # ~5 minutes
cd cli && npm install
npm run upload                     # uploads, imports, waits for indexing — a couple of minutes
npm run verify                     # the proof — a few minutes, see below
npm run ask -- "What is the Frostvane-7 chunking benchmark?" --raw
```

`deploy_cloud.sh` writes `cli/.env` for you (see `terraform/08_cli_env.tf`)
— there's nothing to copy by hand between Terraform and the CLI.

A quota note on `npm run verify`: the project-level limit on answer
generation is **ten calls per minute** (`LlmRequestsPerMinutePerProject`),
and a full verification run makes 22 answer calls — ten positive
probes, ten control probes, one abstention check and one cross-document check.
The CLI backs off and retries automatically when it hits that ceiling
(`withTransientRetry` in `cli/src/search/answer.ts`), so the run legitimately
takes a few minutes and pauses partway through. That's expected, not a
hang.

## What `verify` checks

The suite ran 45 checks against the live deployment, all passing. Grouped:

- **Indexing** (1 check): all ten uploaded documents are indexed and
  listable — `10 of 10 documents indexed`.
- **Positive probes** (10 documents × 3 checks each = 30): for each
  document, ask a question whose answer is that document's invented
  number. The answer has to (a) contain the number, (b) cite exactly that
  document and no other, and (c) come back with a grounding score above
  the 0.6 threshold. Observed grounding scores across the ten documents
  ranged from **0.924 to 0.994**.
- **Control probes** (10 checks): the same ten questions, but with
  retrieval replaced by one irrelevant passage about tomatoes (see
  `UNRELATED_CONTEXT` in `cli/src/search/answer.ts`). None of the invented
  numbers came back — confirming the model isn't guessing or recalling
  them from pretraining.
- **Abstention** (1 check): a question about Kubernetes pod disruption
  budgets, which the corpus never mentions. The app abstained rather than
  hallucinating an answer — the observed response carried
  `answerSkippedReasons: [OUT_OF_DOMAIN_QUERY_IGNORED]` and zero citations.
- **Cross-document** (3 checks): a question that can only be answered by
  combining two documents (the chunking and reranking benchmark figures).
  The answer cited both source documents and carried both numbers.

## Reading the output

`npm run ask -- "..." --raw` prints the answer text, then this tail (trimmed
from a real run; the answer body above it ran to about seven paragraphs).
The bucket name in these examples is a placeholder — yours will carry your
own project id:

```
grounding score: 0.943
citations:
  - gs://vertex-search-rag-YOUR-PROJECT/corpus/chunking-strategies.md
per-claim grounding:
  - 0.996 from gs://vertex-search-rag-YOUR-PROJECT/corpus/chunking-strategies.md
  - 0.988 from gs://vertex-search-rag-YOUR-PROJECT/corpus/chunking-strategies.md
  - 0.991 from gs://vertex-search-rag-YOUR-PROJECT/corpus/chunking-strategies.md
  ...
  - 0.724 from gs://vertex-search-rag-YOUR-PROJECT/corpus/chunking-strategies.md
  - 0.992 from gs://vertex-search-rag-YOUR-PROJECT/corpus/chunking-strategies.md

retrieved chunks:
  - [0.8999999761581421] gs://vertex-search-rag-YOUR-PROJECT/corpus/chunking-strategies.md
    It's more expensive to compute at ingestion time, since every sentence needs an embedding call, but it produces chunks that map to actual ideas rather than arbitrary token counts. Overlap matters regardless of strategy. Without it, a fact that straddles a chunk boundary — a subject introduced in one
  - [0.20000000298023224] gs://vertex-search-rag-YOUR-PROJECT/corpus/chunking-strategies.md
    # Chunking Strategies for RAG When you build a retrieval-augmented system, the single decision with the most leverage over answer quality is how you split source documents into chunks. Get chunking wrong and no amount of prompt engineering downstream will save you — the retriever either returns frag
```

- **`grounding score`** is the app's own confidence that the answer as a
  whole is supported by what it retrieved — here 0.943 against the lab's
  0.6 pass threshold.
- **`citations`** resolves to the actual `gs://` object the answer relied
  on. This is the CLI's own resolution logic in `cli/src/search/shape.ts` —
  the API returns citations as numeric indices into a `references` array,
  and the CLI maps them back to the underlying document URI.
- **`per-claim grounding`** breaks the same score down per sentence
  (`groundingSupports` in the API response). A long answer can have one
  weak sentence pulling down an otherwise strong overall score; this is
  where you'd find it.
- **`--raw` adds `retrieved chunks`**: the actual passages the app pulled
  from the data store before generating the answer, each with its own
  relevance score. Without `--raw`, `ask` shows you only the answer,
  citations and grounding — this flag shows you the evidence the answer
  was built from.

Asking something the corpus doesn't cover — the Kubernetes example from the
verify suite above — comes back with no answer text, `skipped:
OUT_OF_DOMAIN_QUERY_IGNORED`, and no citations, instead of a confidently
wrong answer.

## Tear it down

```bash
./scripts/deploy_cloud.sh --destroy
```

Confirm the bucket and data store are actually gone:

```bash
gcloud storage buckets list --project <your-project-id> --format="value(name)"
gcloud alpha discoveryengine data-stores list --project <your-project-id> --location global
```

Neither should list anything from this lab. This step isn't optional —
until you run it, the data store and search app keep existing (and keep
costing you money, even if not much) in your project.

## What is deliberately missing

This lab is a minimal, fully-managed slice of Vertex AI Search — enough to
prove grounded retrieval works end to end, not a tour of the whole product
surface. Left out on purpose:

- Custom chunking — the data store parses and chunks documents itself
  (`document_processing_config` in `terraform/06_data_store.tf`); there's
  no user-controlled chunk size or overlap here.
- The ranking API — a separate reranking step over search results.
- Standalone grounding checks — the Grounding API used independently of
  search, for grounding answers a model produced some other way.
- Multiple data stores — this app points at exactly one.
- ACL-aware search — no per-document or per-user access control.
- PDFs or any non-Markdown format — the corpus is Markdown only.
- Any UI — this is a CLI-only lab; there's no console or web frontend here.

## Which Google product is this

This lab uses **Vertex AI Search**: the API is
`discoveryengine.googleapis.com`, the Terraform resources are
`google_discovery_engine_data_store` and `google_discovery_engine_search_engine`
(see `terraform/06_data_store.tf` and `terraform/07_search_engine.tf`), and
Google's documentation for it now lives under the "Agent Search" heading.

It's easy to confuse with two adjacent products that solve a similar
problem differently:

- **Vertex AI RAG Engine** is a configurable RAG *pipeline* — you choose
  the chunking, the embedding model, the vector store. This lab doesn't use
  it.
- **Vertex AI Vector Search** is a raw, high-scale approximate-nearest-neighbor
  vector index — no document store, no answer generation, no citations.
  This lab doesn't use that either.

Vertex AI Search, by contrast, is fully managed end to end: point it at
documents, and it handles parsing, chunking, indexing, retrieval, and —
with the LLM add-on this lab enables (`SEARCH_ADD_ON_LLM` in
`terraform/07_search_engine.tf`) — grounded answer generation with
citations, in one API.
