import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildMetadataJsonl, corpusUri, loadCorpus, metadataUri } from "./documents.js";

async function fixtureDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "corpus-"));
  await writeFile(join(dir, "beta.md"), "# Beta topic\n\nBeta body.\n");
  await writeFile(join(dir, "alpha.md"), "# Alpha topic\n\nAlpha body.\n");
  await writeFile(join(dir, "notes.txt"), "not markdown");
  return dir;
}

describe("loadCorpus", () => {
  it("loads markdown files only, sorted by id", async () => {
    const docs = await loadCorpus(await fixtureDir());

    expect(docs.map((d) => d.id)).toEqual(["alpha", "beta"]);
  });

  it("takes the title from the first heading", async () => {
    const docs = await loadCorpus(await fixtureDir());

    expect(docs[0]?.title).toBe("Alpha topic");
  });

  it("fails loudly when a document has no heading", async () => {
    const dir = await mkdtemp(join(tmpdir(), "corpus-"));
    await writeFile(join(dir, "headless.md"), "no heading here\n");

    await expect(loadCorpus(dir)).rejects.toThrow(/headless\.md/);
  });
});

describe("import metadata", () => {
  it("addresses each document by its Cloud Storage URI", async () => {
    const docs = await loadCorpus(await fixtureDir());

    // biome-ignore lint/style/noNonNullAssertion: fixtureDir always writes alpha.md first alphabetically
    expect(corpusUri("demo-bucket", docs[0]!)).toBe("gs://demo-bucket/corpus/alpha.md");
    expect(metadataUri("demo-bucket")).toBe("gs://demo-bucket/metadata/documents.jsonl");
  });

  it("emits one JSON line per document with id, structData and content", async () => {
    const docs = await loadCorpus(await fixtureDir());

    const lines = buildMetadataJsonl(docs, "demo-bucket").trimEnd().split("\n");

    expect(lines).toHaveLength(2);
    // biome-ignore lint/style/noNonNullAssertion: length just asserted to be 2, so index 0 exists
    expect(JSON.parse(lines[0]!)).toEqual({
      id: "alpha",
      structData: { docId: "alpha", title: "Alpha topic" },
      content: { mimeType: "text/markdown", uri: "gs://demo-bucket/corpus/alpha.md" },
    });
  });
});
