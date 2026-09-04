import { describe, expect, it } from "vitest";
import {
  type ChildLister,
  DOC_MIME_TYPE,
  type DriveEntry,
  documentsOf,
  FOLDER_MIME_TYPE,
  findChildFolder,
  isFolder,
  walkTree,
} from "./tree.js";

const PDF_MIME_TYPE = "application/pdf";

function entry(id: string, name: string, mimeType: string, parents: string[]): DriveEntry {
  return { id, name, mimeType, modifiedTime: "2026-09-01T10:00:00.000Z", parents };
}

/**
 *  root
 *    retrieval/     -> alpha, beta
 *    evaluation/    -> gamma
 */
const TREE: Record<string, DriveEntry[]> = {
  root: [
    entry("f-retrieval", "retrieval", FOLDER_MIME_TYPE, ["root"]),
    entry("f-evaluation", "evaluation", FOLDER_MIME_TYPE, ["root"]),
  ],
  "f-retrieval": [
    entry("d-alpha", "alpha", DOC_MIME_TYPE, ["f-retrieval"]),
    entry("d-beta", "beta", DOC_MIME_TYPE, ["f-retrieval"]),
  ],
  "f-evaluation": [entry("d-gamma", "gamma", DOC_MIME_TYPE, ["f-evaluation"])],
};

const lister: ChildLister = async (parentId) => TREE[parentId] ?? [];

describe("isFolder", () => {
  it("recognises the Drive folder mime type", () => {
    expect(isFolder(entry("x", "x", FOLDER_MIME_TYPE, []))).toBe(true);
    expect(isFolder(entry("x", "x", DOC_MIME_TYPE, []))).toBe(false);
  });
});

describe("walkTree", () => {
  it("descends into subfolders, since Drive has no recursive query", async () => {
    const nodes = await walkTree(lister, "root", "corpus");

    expect(nodes.map((node) => node.id).sort()).toEqual(
      ["d-alpha", "d-beta", "d-gamma", "f-evaluation", "f-retrieval"].sort(),
    );
  });

  it("records the path each node was found at", async () => {
    const nodes = await walkTree(lister, "root", "corpus");
    const pathOf = new Map(nodes.map((node) => [node.id, node.path]));

    expect(pathOf.get("f-retrieval")).toBe("corpus/retrieval");
    expect(pathOf.get("d-alpha")).toBe("corpus/retrieval/alpha");
    expect(pathOf.get("d-gamma")).toBe("corpus/evaluation/gamma");
  });

  it("marks folders so callers can tell them from documents", async () => {
    const nodes = await walkTree(lister, "root", "corpus");

    expect(nodes.find((node) => node.id === "f-retrieval")?.isFolder).toBe(true);
    expect(nodes.find((node) => node.id === "d-alpha")?.isFolder).toBe(false);
  });

  it("returns nothing for an empty root rather than throwing", async () => {
    expect(await walkTree(lister, "empty-folder", "corpus")).toEqual([]);
  });

  it("stops rather than looping forever when two folders contain each other", async () => {
    const cyclic: ChildLister = async (parentId) => {
      if (parentId === "root") {
        return [entry("f-loop", "loop", FOLDER_MIME_TYPE, ["root"])];
      }
      if (parentId === "f-loop") {
        return [entry("root", "root", FOLDER_MIME_TYPE, ["f-loop"])];
      }
      return [];
    };

    const nodes = await walkTree(cyclic, "root", "corpus");

    expect(nodes.map((node) => node.id)).toEqual(["f-loop"]);
  });
});

describe("documentsOf", () => {
  it("keeps only the documents", async () => {
    const docs = documentsOf(await walkTree(lister, "root", "corpus"));

    expect(docs.map((doc) => doc.id).sort()).toEqual(["d-alpha", "d-beta", "d-gamma"]);
  });

  it("keeps a Google Doc", () => {
    const nodes = [
      { ...entry("d-1", "doc", DOC_MIME_TYPE, []), path: "corpus/doc", isFolder: false },
    ];

    expect(documentsOf(nodes).map((node) => node.id)).toEqual(["d-1"]);
  });

  it("excludes a non-Doc file, such as a PDF someone dropped into corpus/", () => {
    const nodes = [
      {
        ...entry("f-1", "notes.pdf", PDF_MIME_TYPE, []),
        path: "corpus/notes.pdf",
        isFolder: false,
      },
    ];

    expect(documentsOf(nodes)).toEqual([]);
  });
});

describe("findChildFolder", () => {
  it("finds a folder by name under a parent", async () => {
    expect((await findChildFolder(lister, "root", "retrieval"))?.id).toBe("f-retrieval");
  });

  it("returns null when the folder is absent", async () => {
    expect(await findChildFolder(lister, "root", "nope")).toBeNull();
  });

  it("ignores documents that happen to share the name", async () => {
    const shadowed: ChildLister = async () => [entry("d-x", "retrieval", DOC_MIME_TYPE, ["root"])];

    expect(await findChildFolder(shadowed, "root", "retrieval")).toBeNull();
  });
});
