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

/**
 * FULL rebases the data store against exactly what is staged, so documents that
 * left the Drive folder are removed. INCREMENTAL upserts by id and never removes
 * anything — which is why a deletion or a move-out is invisible to it.
 */
export async function importStaged(
  client: DocumentServiceClient,
  branch: string,
  metadataGcsUri: string,
  mode: "FULL" | "INCREMENTAL",
  logger: Logger,
): Promise<ImportOutcome> {
  try {
    logger.info({ branch, metadataGcsUri, mode }, "Importing documents...");

    const [operation] = await client.importDocuments({
      parent: branch,
      gcsSource: { inputUris: [metadataGcsUri], dataSchema: "document" },
      reconciliationMode: mode,
      // Without an error prefix the import goes looking for a staging bucket of
      // its own and fails on storage.buckets.create.
      errorConfig: { gcsPrefix: `${metadataGcsUri.replace(/\/[^/]+$/, "")}/errors` },
    });
    const [, metadata] = await operation.promise();
    const outcome = readImportMetadata(metadata);

    if (outcome.failureCount > 0) {
      throw new Error(
        `Import reported ${outcome.failureCount} failures: ${outcome.errorSamples.join("; ")}`,
      );
    }

    logger.info(
      { branch, mode, successCount: outcome.successCount },
      "Importing documents succeeded.",
    );
    return outcome;
  } catch (err) {
    logger.error({ err, branch, metadataGcsUri, mode }, "Importing documents failed.");
    throw err;
  }
}

export async function listIndexedDocumentIds(
  client: DocumentServiceClient,
  branch: string,
): Promise<string[]> {
  const [documents] = await client.listDocuments({ parent: branch, pageSize: 100 });
  return documents.map((document) => document.id ?? "").filter((id) => id !== "");
}

/**
 * Import returns as soon as the documents are accepted; they are not queryable
 * until indexing finishes. Polling here keeps the wait out of `verify`.
 */
export async function waitForDocumentCount(
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
      const ids = await listIndexedDocumentIds(client, branch);
      if (ids.length === expected) {
        logger.info({ branch, count: ids.length }, "Waiting for indexing succeeded.");
        return ids.length;
      }
      if (Date.now() >= deadline) {
        throw new Error(
          `Data store held ${ids.length} documents, expected ${expected}, before the timeout.`,
        );
      }
      logger.info({ count: ids.length, expected }, "Waiting for indexing...");
      await new Promise((resolve) => setTimeout(resolve, options.intervalMs));
    }
  } catch (err) {
    logger.error({ err, branch, expected }, "Waiting for indexing failed.");
    throw err;
  }
}
