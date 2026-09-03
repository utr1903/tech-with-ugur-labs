import type { GoogleAuth } from "google-auth-library";
import {
  buildMetadataJsonl,
  type CorpusDocument,
  corpusObjectName,
  METADATA_OBJECT_NAME,
} from "../corpus/documents.js";
import type { Logger } from "../logger.js";

export interface ObjectWriter {
  save(objectName: string, contents: string, contentType: string): Promise<void>;
}

/**
 * The Cloud Storage client library still ships an auth stack built on
 * node-fetch 2, which breaks on current Node. A single-object upload is one
 * HTTP POST, so we make it ourselves with the auth the search client already uses.
 */
export function bucketWriter(auth: GoogleAuth, bucket: string): ObjectWriter {
  return {
    save: async (objectName, contents, contentType) => {
      const token = await auth.getAccessToken();
      if (token === null || token === undefined) {
        throw new Error(`No access token available to upload ${objectName} to ${bucket}.`);
      }

      const url = `https://storage.googleapis.com/upload/storage/v1/b/${bucket}/o?uploadType=media&name=${encodeURIComponent(objectName)}`;
      const response = await fetch(url, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": contentType },
        body: contents,
      });
      if (!response.ok) {
        throw new Error(
          `Uploading ${objectName} to ${bucket} failed: ${response.status} ${await response.text()}`,
        );
      }
    },
  };
}

export async function uploadCorpus(
  writer: ObjectWriter,
  docs: CorpusDocument[],
  bucket: string,
  logger: Logger,
): Promise<string[]> {
  try {
    logger.info({ bucket, documentCount: docs.length }, "Uploading the corpus...");

    const written: string[] = [];
    for (const doc of docs) {
      const objectName = corpusObjectName(doc);
      await writer.save(objectName, doc.body, "text/markdown");
      written.push(objectName);
    }

    await writer.save(METADATA_OBJECT_NAME, buildMetadataJsonl(docs, bucket), "application/jsonl");
    written.push(METADATA_OBJECT_NAME);

    logger.info({ bucket, objectCount: written.length }, "Uploading the corpus succeeded.");
    return written;
  } catch (err) {
    logger.error({ err, bucket }, "Uploading the corpus failed.");
    throw err;
  }
}
