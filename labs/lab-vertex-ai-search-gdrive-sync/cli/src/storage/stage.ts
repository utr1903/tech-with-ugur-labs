import type { GoogleAuth } from "google-auth-library";
import type { Logger } from "../logger.js";

export interface StagedDocument {
  driveFileId: string;
  path: string;
  title: string;
  markdown: string;
}

const METADATA_OBJECT_NAME = "metadata/documents.jsonl";
const MARKDOWN_MIME_TYPE = "text/markdown";

export function stagedObjectName(driveFileId: string): string {
  return `corpus/${driveFileId}.md`;
}

export function stagedUri(bucket: string, driveFileId: string): string {
  return `gs://${bucket}/${stagedObjectName(driveFileId)}`;
}

export function metadataUri(bucket: string): string {
  return `gs://${bucket}/${METADATA_OBJECT_NAME}`;
}

/**
 * The `document` data schema: one JSON line per document pointing at the staged
 * object. The id is the Drive file id, which is stable across renames and moves,
 * so reorganising the Drive folder never re-creates a document.
 */
export function buildMetadataJsonl(docs: StagedDocument[], bucket: string): string {
  return `${docs
    .map((doc) =>
      JSON.stringify({
        id: doc.driveFileId,
        structData: { driveFileId: doc.driveFileId, path: doc.path, title: doc.title },
        content: { mimeType: MARKDOWN_MIME_TYPE, uri: stagedUri(bucket, doc.driveFileId) },
      }),
    )
    .join("\n")}\n`;
}

export interface ObjectWriter {
  save(objectName: string, contents: string, contentType: string): Promise<void>;
}

/**
 * One POST to the JSON API instead of @google-cloud/storage: that package's
 * current release pins an auth stack whose token refresh breaks on modern Node.
 */
export function jsonApiWriter(auth: GoogleAuth, bucket: string): ObjectWriter {
  return {
    save: async (objectName, contents, contentType) => {
      const client = await auth.getClient();
      const url = `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(bucket)}/o?uploadType=media&name=${encodeURIComponent(objectName)}`;
      await client.request({
        url,
        method: "POST",
        headers: { "Content-Type": contentType },
        body: contents,
      });
    },
  };
}

export async function stageDocuments(
  writer: ObjectWriter,
  docs: StagedDocument[],
  bucket: string,
  logger: Logger,
): Promise<string[]> {
  try {
    logger.info({ bucket, documentCount: docs.length }, "Staging documents...");

    if (docs.length === 0) {
      throw new Error("Refusing to stage no documents: a FULL import would empty the data store.");
    }

    const written: string[] = [];
    for (const doc of docs) {
      const objectName = stagedObjectName(doc.driveFileId);
      await writer.save(objectName, doc.markdown, MARKDOWN_MIME_TYPE);
      written.push(objectName);
    }

    await writer.save(METADATA_OBJECT_NAME, buildMetadataJsonl(docs, bucket), "application/jsonl");
    written.push(METADATA_OBJECT_NAME);

    logger.info({ bucket, objectCount: written.length }, "Staging documents succeeded.");
    return written;
  } catch (err) {
    logger.error({ err, bucket }, "Staging documents failed.");
    throw err;
  }
}
