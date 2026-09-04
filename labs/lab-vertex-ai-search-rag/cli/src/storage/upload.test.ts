import type { GoogleAuth } from "google-auth-library";
import { describe, expect, it } from "vitest";
import type { CorpusDocument } from "../corpus/documents.js";
import type { Logger } from "../logger.js";
import { bucketWriter, type ObjectWriter, uploadCorpus } from "./upload.js";

const DOCS: CorpusDocument[] = [
  { id: "alpha", fileName: "alpha.md", title: "Alpha topic", body: "# Alpha topic\n\nBody.\n" },
];

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

const silentLogger = { info: () => undefined, error: () => undefined } as unknown as Logger;

describe("uploadCorpus", () => {
  it("writes each document under corpus/ as markdown", async () => {
    const { writer, writes } = recordingWriter();

    await uploadCorpus(writer, DOCS, "demo-bucket", silentLogger);

    expect(writes[0]?.[0]).toBe("corpus/alpha.md");
    expect(writes[0]?.[2]).toBe("text/markdown");
  });

  it("writes the import metadata last, so it never points at a missing document", async () => {
    const { writer, writes } = recordingWriter();

    const written = await uploadCorpus(writer, DOCS, "demo-bucket", silentLogger);

    expect(writes.at(-1)?.[0]).toBe("metadata/documents.jsonl");
    expect(writes.at(-1)?.[1]).toContain("gs://demo-bucket/corpus/alpha.md");
    expect(written).toEqual(["corpus/alpha.md", "metadata/documents.jsonl"]);
  });
});

function stubAuth(token: string): GoogleAuth {
  return { getAccessToken: async () => token } as unknown as GoogleAuth;
}

describe("bucketWriter", () => {
  it("throws with the response status when the upload request fails", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response("access denied", { status: 403 })) as typeof fetch;

    try {
      const writer = bucketWriter(stubAuth("test-token"), "demo-bucket");

      await expect(writer.save("corpus/alpha.md", "body", "text/markdown")).rejects.toThrow(/403/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
