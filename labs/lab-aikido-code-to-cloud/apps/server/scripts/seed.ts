import { parseArgs } from "node:util";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { createS3Store } from "../src/data/s3";
import { generateDataset } from "./generate";

async function main() {
  const { values } = parseArgs({
    options: {
      bucket: { type: "string" },
      region: { type: "string", default: "eu-central-1" },
      customers: { type: "string", default: "25" },
      seed: { type: "string", default: "42" },
    },
  });
  if (!values.bucket) {
    console.error("usage: seed --bucket <name> [--region eu-central-1] [--customers 25] [--seed 42]");
    process.exit(1);
  }
  const client = new S3Client({ region: values.region });
  const store = createS3Store(client, values.bucket);
  const data = generateDataset({ customers: Number(values.customers), seed: Number(values.seed), now: new Date() });
  for (const [key, value] of data) {
    if (typeof value === "string") {
      await client.send(new PutObjectCommand({ Bucket: values.bucket, Key: key, Body: value, ContentType: "text/plain" }));
    } else {
      await store.putJson(key, value);
    }
  }
  console.log(`Seeded ${data.size} objects into s3://${values.bucket}`);
  const users = JSON.parse(readFileSync(join(__dirname, "../src/data/users.json"), "utf8")) as Array<{ username: string; password: string; role: string }>;
  console.log("Demo logins:");
  for (const u of users) console.log(`  ${u.username} / ${u.password} (${u.role})`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
