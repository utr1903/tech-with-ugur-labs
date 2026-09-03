import type { Storage } from "@google-cloud/storage";
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

export function bucketWriter(storage: Storage, bucket: string): ObjectWriter {
  return {
    save: async (objectName, contents, contentType) => {
      await storage.bucket(bucket).file(objectName).save(contents, { contentType });
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
