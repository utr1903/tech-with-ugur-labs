import { GoogleAuth } from "google-auth-library";
import { branchPath, type LabConfig } from "../config/config.js";
import { importErrorPrefix, loadCorpus, metadataUri } from "../corpus/documents.js";
import type { Logger } from "../logger.js";
import { documentClient } from "../search/clients.js";
import { importCorpus, waitForDocuments } from "../search/import.js";
import { bucketWriter, uploadCorpus } from "../storage/upload.js";

const INDEXING_TIMEOUT_MS = 15 * 60 * 1000;
const INDEXING_POLL_INTERVAL_MS = 15 * 1000;

export async function runUpload(config: LabConfig, logger: Logger): Promise<void> {
  const docs = await loadCorpus(config.corpusDir);
  const auth = new GoogleAuth({ scopes: "https://www.googleapis.com/auth/cloud-platform" });
  const writer = bucketWriter(auth, config.bucket);
  await uploadCorpus(writer, docs, config.bucket, logger);

  const client = documentClient(config);
  const branch = branchPath(config);
  await importCorpus(
    client,
    branch,
    metadataUri(config.bucket),
    importErrorPrefix(config.bucket),
    logger,
  );
  await waitForDocuments(
    client,
    branch,
    docs.length,
    { timeoutMs: INDEXING_TIMEOUT_MS, intervalMs: INDEXING_POLL_INTERVAL_MS },
    logger,
  );
}
