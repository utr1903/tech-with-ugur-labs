import { describe, expect, it } from "vitest";
import {
  buildMetadataJsonl,
  metadataUri,
  type ObjectWriter,
  type StagedDocument,
  stageDocuments,
  stagedObjectName,
  stagedUri,
} from "./stage.js";

const DOCS: StagedDocument[] = [
  {
    driveFileId: "1AbCdEf",
    path: "corpus/retrieval/chunking-strategies",
    title: "Chunking strategies",
    markdown: "# Chunking strategies\n\nBody.\n",
  },
];

const silentLogger = {
  info: () => undefined,
  error: () => undefined,
} as unknown as import("../logger.js").Logger;

function recordingWriter(): { writer: ObjectWriter; writes: Array<[string, string, string]> } {
  const writes: Array<[string, string, string]> = [];
  return {
    writes,
    writer: {
      save: async (objectName, contents, contentType) => {
        writes.push([objectName, contents, contentType]);
      },
    },
  };
}

describe("object naming", () => {
  it("names staged objects after the Drive file id, not the path", () => {
    expect(stagedObjectName("1AbCdEf")).toBe("corpus/1AbCdEf.md");
    expect(stagedUri("demo-bucket", "1AbCdEf")).toBe("gs://demo-bucket/corpus/1AbCdEf.md");
    expect(metadataUri("demo-bucket")).toBe("gs://demo-bucket/metadata/documents.jsonl");
  });
});

describe("buildMetadataJsonl", () => {
  it("uses the Drive file id as the document id", () => {
    const line = JSON.parse(buildMetadataJsonl(DOCS, "demo-bucket").trimEnd());

    expect(line.id).toBe("1AbCdEf");
    expect(line.content).toEqual({
      mimeType: "text/markdown",
      uri: "gs://demo-bucket/corpus/1AbCdEf.md",
    });
  });

  it("carries the Drive path so a raw answer can be traced back to the Doc", () => {
    const line = JSON.parse(buildMetadataJsonl(DOCS, "demo-bucket").trimEnd());

    expect(line.structData).toEqual({
      driveFileId: "1AbCdEf",
      path: "corpus/retrieval/chunking-strategies",
      title: "Chunking strategies",
    });
  });

  it("emits one line per document, newline terminated", () => {
    const jsonl = buildMetadataJsonl([...DOCS, { ...DOCS[0]!, driveFileId: "2Gh" }], "b");

    expect(jsonl.endsWith("\n")).toBe(true);
    expect(jsonl.trimEnd().split("\n")).toHaveLength(2);
  });
});

describe("stageDocuments", () => {
  it("writes each document as markdown under corpus/", async () => {
    const { writer, writes } = recordingWriter();

    await stageDocuments(writer, DOCS, "demo-bucket", silentLogger);

    expect(writes[0]?.[0]).toBe("corpus/1AbCdEf.md");
    expect(writes[0]?.[2]).toBe("text/markdown");
  });

  it("writes the metadata last, so it never points at a missing object", async () => {
    const { writer, writes } = recordingWriter();

    const written = await stageDocuments(writer, DOCS, "demo-bucket", silentLogger);

    expect(writes.at(-1)?.[0]).toBe("metadata/documents.jsonl");
    expect(written).toEqual(["corpus/1AbCdEf.md", "metadata/documents.jsonl"]);
  });

  it("refuses to stage an empty corpus, which would empty the data store", async () => {
    const { writer } = recordingWriter();

    await expect(stageDocuments(writer, [], "demo-bucket", silentLogger)).rejects.toThrow(
      /no documents/i,
    );
  });
});
