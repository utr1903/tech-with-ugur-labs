import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";

export interface CorpusDocument {
  id: string;
  fileName: string;
  title: string;
  body: string;
}

export const METADATA_OBJECT_NAME = "metadata/documents.jsonl";

/** Markdown is a natively supported ingestion format; this is the mime type it goes in as. */
const MARKDOWN_MIME_TYPE = "text/markdown";

function titleOf(body: string, fileName: string): string {
  const heading = body.split("\n").find((line) => line.startsWith("# "));
  if (heading === undefined) {
    throw new Error(`Corpus document ${fileName} has no "# " heading to use as its title.`);
  }
  return heading.slice(2).trim();
}

export async function loadCorpus(dir: string): Promise<CorpusDocument[]> {
  const fileNames = (await readdir(dir)).filter((name) => name.endsWith(".md")).sort();

  return Promise.all(
    fileNames.map(async (fileName) => {
      const body = await readFile(join(dir, fileName), "utf8");
      return {
        id: basename(fileName, ".md"),
        fileName,
        title: titleOf(body, fileName),
        body,
      };
    }),
  );
}

export function corpusObjectName(doc: CorpusDocument): string {
  return `corpus/${doc.fileName}`;
}

export function corpusUri(bucket: string, doc: CorpusDocument): string {
  return `gs://${bucket}/${corpusObjectName(doc)}`;
}

export function metadataUri(bucket: string): string {
  return `gs://${bucket}/${METADATA_OBJECT_NAME}`;
}

export function importErrorPrefix(bucket: string): string {
  return `gs://${bucket}/import-errors`;
}

/**
 * The `document` data schema: one JSON line per document, pointing at the real
 * file in Cloud Storage. This is what lets us choose the document ids instead of
 * having them hashed from the URI.
 */
export function buildMetadataJsonl(docs: CorpusDocument[], bucket: string): string {
  return `${docs
    .map((doc) =>
      JSON.stringify({
        id: doc.id,
        structData: { docId: doc.id, title: doc.title },
        content: { mimeType: MARKDOWN_MIME_TYPE, uri: corpusUri(bucket, doc) },
      }),
    )
    .join("\n")}\n`;
}
