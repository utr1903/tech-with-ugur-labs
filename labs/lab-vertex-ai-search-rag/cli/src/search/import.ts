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
  logger: Logger,
): Promise<ImportOutcome> {
  try {
    logger.info({ branch, metadataGcsUri }, "Importing documents...");

    const [operation] = await client.importDocuments({
      parent: branch,
      gcsSource: { inputUris: [metadataGcsUri], dataSchema: "document" },
      reconciliationMode: "INCREMENTAL",
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
      const [documents] = await client.listDocuments({ parent: branch, pageSize: 100 });
      if (documents.length >= expected) {
        logger.info({ branch, count: documents.length }, "Waiting for indexing succeeded.");
        return documents.length;
      }
      if (Date.now() >= deadline) {
        throw new Error(
          `Only ${documents.length} of ${expected} documents were listed before the timeout.`,
        );
      }
      logger.info({ count: documents.length, expected }, "Waiting for indexing...");
      await new Promise((resolve) => setTimeout(resolve, options.intervalMs));
    }
  } catch (err) {
    logger.error({ err, branch, expected }, "Waiting for indexing failed.");
    throw err;
  }
}
