import { Storage } from "@google-cloud/storage";
import { branchPath, type LabConfig } from "../config/config.js";
import { loadCorpus, metadataUri } from "../corpus/documents.js";
import type { Logger } from "../logger.js";
import { documentClient } from "../search/clients.js";
import { importCorpus, waitForDocuments } from "../search/import.js";
import { bucketWriter, uploadCorpus } from "../storage/upload.js";

const INDEXING_TIMEOUT_MS = 15 * 60 * 1000;
const INDEXING_POLL_INTERVAL_MS = 15 * 1000;

export async function runUpload(config: LabConfig, logger: Logger): Promise<void> {
  const docs = await loadCorpus(config.corpusDir);
  const writer = bucketWriter(new Storage({ projectId: config.projectId }), config.bucket);
  await uploadCorpus(writer, docs, config.bucket, logger);

  const client = documentClient(config);
  const branch = branchPath(config);
  await importCorpus(client, branch, metadataUri(config.bucket), logger);
  await waitForDocuments(
    client,
    branch,
    docs.length,
    { timeoutMs: INDEXING_TIMEOUT_MS, intervalMs: INDEXING_POLL_INTERVAL_MS },
    logger,
  );
}
