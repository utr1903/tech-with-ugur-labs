import type { DocumentServiceClient } from "@google-cloud/discoveryengine";
import type { Logger } from "../logger.js";

export interface ImportOutcome {
  successCount: number;
  failureCount: number;
  errorSamples: string[];
}

interface RawImportMetadata {
  successCount?: number | string | null;
  failureCount?: number | string | null;
  errorSamples?: Array<{ message?: string | null }> | null;
}

/** The operation reports its counts as int64, which the client hands back as strings. */
export function readImportMetadata(metadata: unknown): ImportOutcome {
  const raw = (metadata ?? {}) as RawImportMetadata;
  return {
    successCount: Number(raw.successCount ?? 0),
    failureCount: Number(raw.failureCount ?? 0),
    errorSamples: (raw.errorSamples ?? []).map((error) => error.message ?? "unknown error"),
  };
}

export async function importCorpus(
  client: DocumentServiceClient,
  branch: string,
  metadataGcsUri: string,
  errorGcsPrefix: string,
  logger: Logger,
): Promise<ImportOutcome> {
  try {
    logger.info({ branch, metadataGcsUri, errorGcsPrefix }, "Importing documents...");

    const [operation] = await client.importDocuments({
      parent: branch,
      gcsSource: { inputUris: [metadataGcsUri], dataSchema: "document" },
      reconciliationMode: "INCREMENTAL",
      // Without an errorConfig, the service tries to create its own staging
      // bucket to hold the per-document error log, which needs project-wide
      // storage.buckets.create rights the service agent should not have.
      // Pointing it at a prefix in the bucket we already own avoids that.
      errorConfig: { gcsPrefix: errorGcsPrefix },
    });
    const [, metadata] = await operation.promise();
    const outcome = readImportMetadata(metadata);

    if (outcome.failureCount > 0) {
      throw new Error(
        `Import reported ${outcome.failureCount} failures: ${outcome.errorSamples.join("; ")}`,
      );
    }

    logger.info({ branch, successCount: outcome.successCount }, "Importing documents succeeded.");
    return outcome;
  } catch (err) {
    logger.error({ err, branch, metadataGcsUri }, "Importing documents failed.");
    throw err;
  }
}

// autoPaginate: false keeps this to the one page we ask for; without it gax
// warns and pages through everything anyway. pageSize 100 comfortably covers
// this ten-document corpus and headroom for anyone who extends it in one page.
async function listIndexedDocuments(client: DocumentServiceClient, branch: string) {
  const [documents] = await client.listDocuments(
    { parent: branch, pageSize: 100 },
    { autoPaginate: false },
  );
  return documents;
}

export async function countDocuments(
  client: DocumentServiceClient,
  branch: string,
  logger: Logger,
): Promise<number> {
  try {
    logger.info({ branch }, "Counting indexed documents...");

    const documents = await listIndexedDocuments(client, branch);
    const count = documents.length;

    logger.info({ branch, count }, "Counting indexed documents succeeded.");
    return count;
  } catch (err) {
    logger.error({ err, branch }, "Counting indexed documents failed.");
    throw err;
  }
}

/**
 * Import returns as soon as the documents are accepted; they are not queryable
 * until indexing finishes, which takes minutes. Polling here keeps that wait out
 * of `verify`.
 */
export async function waitForDocuments(
  client: DocumentServiceClient,
  branch: string,
  expected: number,
  options: { timeoutMs: number; intervalMs: number },
  logger: Logger,
): Promise<number> {
  const deadline = Date.now() + options.timeoutMs;

  try {
    logger.info({ branch, expected }, "Waiting for indexing...");

    for (;;) {
      const documents = await listIndexedDocuments(client, branch);
      if (documents.length >= expected) {
        logger.info({ branch, count: documents.length }, "Waiting for indexing succeeded.");
        return documents.length;
      }
      if (Date.now() >= deadline) {
        throw new Error(
          `Only ${documents.length} of ${expected} documents were listed before the timeout.`,
        );
      }
      logger.info(
        { count: documents.length, expected },
        "Waiting for indexing, not all documents listed yet.",
      );
      await new Promise((resolve) => setTimeout(resolve, options.intervalMs));
    }
  } catch (err) {
    logger.error({ err, branch, expected }, "Waiting for indexing failed.");
    throw err;
  }
}
