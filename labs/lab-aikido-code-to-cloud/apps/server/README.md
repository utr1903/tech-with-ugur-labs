# PayBuddy server

Deliberately vulnerable demo payments chatbot (Express + LangChain on Amazon Bedrock Nova 2 Lite). Every planted flaw is marked with an `INSECURE-BY-DESIGN:` comment.

## Run locally

1. Create only the data bucket, from the lab's `infra/`:
   `terraform init && terraform apply -auto-approve -target=aws_s3_bucket.data -target=aws_s3_bucket_public_access_block.data`
2. Get its name: `terraform -chdir=infra output -raw data_bucket_name`
3. Seed it, from `apps/server`: `npm run seed -- --bucket <bucket>` (optional `--region`, default `eu-central-1`).
4. Start: `DATA_BUCKET=<bucket> npm run dev` (needs AWS credentials with S3 and Bedrock access, region `eu-central-1`). For a production-style run use `npm run build && DATA_BUCKET=<bucket> npm start`.
5. Open http://localhost:8080 or use curl against `/api/login` and `/api/chat`.

## Demo logins

`alice` / `alice123` (cus_0001), plus the other seeded customers and an admin in `src/data/users.json`.

## Environment

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `8080` | HTTP port |
| `AWS_REGION` | `eu-central-1` | AWS region for S3 and Bedrock |
| `DATA_BUCKET` | required | S3 bucket with seeded customer data |
| `BEDROCK_MODEL_ID` | `eu.amazon.nova-2-lite-v1:0` | Bedrock model |
| `AIKIDO_TOKEN` | unset | Reserved for Aikido Zen (in-app firewall, out of scope for this lab) |
| `AIKIDO_BLOCK` | `true` | Reserved for Aikido Zen (in-app firewall, out of scope for this lab) |
