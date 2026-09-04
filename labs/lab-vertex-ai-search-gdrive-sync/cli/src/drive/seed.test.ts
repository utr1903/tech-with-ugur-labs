import { describe, expect, it } from "vitest";
import type { SourceDocument } from "../corpus/sources.js";
import { type DocUploader, ensureFolder, type FolderEnsurer, seedDocuments } from "./seed.js";

function source(folder: string, name: string): SourceDocument {
  return { id: `${folder}/${name}`, folder, name, title: name, body: `# ${name}\n\nBody.\n` };
}

function fakeEnsurer(existing: Record<string, string> = {}): {
  ensurer: FolderEnsurer;
  created: string[];
} {
  const created: string[] = [];
  const store = { ...existing };
  return {
    created,
    ensurer: {
      find: async (parentId, name) => store[`${parentId}/${name}`] ?? null,
      create: async (parentId, name) => {
        created.push(`${parentId}/${name}`);
        const id = `id-${name}`;
        store[`${parentId}/${name}`] = id;
        return id;
      },
    },
  };
}

function fakeUploader(existing: Record<string, string> = {}): {
  uploader: DocUploader;
  created: string[];
} {
  const created: string[] = [];
  return {
    created,
    uploader: {
      find: async (parentId, name) => existing[`${parentId}/${name}`] ?? null,
      create: async (parentId, name) => {
        created.push(`${parentId}/${name}`);
        return `doc-${name}`;
      },
    },
  };
}

describe("ensureFolder", () => {
  it("creates the folder when it is missing", async () => {
    const { ensurer, created } = fakeEnsurer();

    expect(await ensureFolder(ensurer, "root", "corpus")).toBe("id-corpus");
    expect(created).toEqual(["root/corpus"]);
  });

  it("reuses an existing folder rather than making a second one", async () => {
    const { ensurer, created } = fakeEnsurer({ "root/corpus": "already-there" });

    expect(await ensureFolder(ensurer, "root", "corpus")).toBe("already-there");
    expect(created).toEqual([]);
  });
});

describe("seedDocuments", () => {
  const sources = [source("retrieval", "alpha"), source("evaluation", "gamma")];
  const folderIds = new Map([
    ["retrieval", "f-retrieval"],
    ["evaluation", "f-evaluation"],
  ]);

  it("creates one Doc per source in its folder", async () => {
    const { uploader, created } = fakeUploader();

    const result = await seedDocuments(uploader, folderIds, sources);

    expect(created.sort()).toEqual(["f-evaluation/gamma", "f-retrieval/alpha"]);
    expect(result.created).toHaveLength(2);
  });

  it("is idempotent: an existing Doc is left alone", async () => {
    const { uploader, created } = fakeUploader({ "f-retrieval/alpha": "doc-alpha" });

    const result = await seedDocuments(uploader, folderIds, sources);

    expect(created).toEqual(["f-evaluation/gamma"]);
    expect(result.existing).toEqual(["retrieval/alpha"]);
  });

  it("fails loudly when a source names a folder that was not created", async () => {
    const { uploader } = fakeUploader();

    await expect(seedDocuments(uploader, new Map(), sources)).rejects.toThrow(/retrieval/);
  });
});
