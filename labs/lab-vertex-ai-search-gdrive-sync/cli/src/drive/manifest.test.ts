import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildManifest,
  diffManifests,
  readManifest,
  summariseDiff,
  writeManifest,
} from "./manifest.js";
import { DOC_MIME_TYPE, type DriveNode } from "./tree.js";

function node(id: string, path: string, modifiedTime: string, isFolder = false): DriveNode {
  return {
    id,
    name: path.split("/").at(-1) ?? "",
    mimeType: isFolder ? "application/vnd.google-apps.folder" : DOC_MIME_TYPE,
    modifiedTime,
    parents: [],
    path,
    isFolder,
  };
}

const T1 = "2026-09-01T10:00:00.000Z";
const T2 = "2026-09-02T11:00:00.000Z";

describe("buildManifest", () => {
  it("records only documents, keyed on the Drive file id", () => {
    const manifest = buildManifest("drive-1", "root", [
      node("f-1", "corpus/retrieval", T1, true),
      node("d-1", "corpus/retrieval/alpha", T1),
    ]);

    expect(manifest.entries.map((entry) => entry.id)).toEqual(["d-1"]);
    expect(manifest.driveId).toBe("drive-1");
    expect(manifest.rootId).toBe("root");
  });

  it("sorts entries so two manifests of the same tree are identical", () => {
    const manifest = buildManifest("drive-1", "root", [
      node("d-2", "corpus/b", T1),
      node("d-1", "corpus/a", T1),
    ]);

    expect(manifest.entries.map((entry) => entry.id)).toEqual(["d-1", "d-2"]);
  });
});

describe("diffManifests", () => {
  const before = buildManifest("d", "root", [node("d-1", "corpus/retrieval/alpha", T1)]);

  it("treats everything as added when there is no previous manifest", () => {
    const diff = diffManifests(null, before);

    expect(diff.added.map((entry) => entry.id)).toEqual(["d-1"]);
    expect(diff.contentChanged).toEqual([]);
  });

  it("reports nothing when nothing changed", () => {
    const diff = diffManifests(before, before);

    expect(diff).toEqual({ added: [], contentChanged: [], moved: [], removed: [] });
  });

  it("reports a content change when modifiedTime moves", () => {
    const after = buildManifest("d", "root", [node("d-1", "corpus/retrieval/alpha", T2)]);
    const diff = diffManifests(before, after);

    expect(diff.contentChanged.map((entry) => entry.id)).toEqual(["d-1"]);
    expect(diff.moved).toEqual([]);
  });

  it("reports a move as a path change, not a content change", () => {
    const after = buildManifest("d", "root", [node("d-1", "corpus/generation/alpha", T1)]);
    const diff = diffManifests(before, after);

    expect(diff.moved).toEqual([{ entry: after.entries[0], from: "corpus/retrieval/alpha" }]);
    expect(diff.contentChanged).toEqual([]);
  });

  it("treats a rename as a move, since the id is what identifies a document", () => {
    const after = buildManifest("d", "root", [node("d-1", "corpus/retrieval/renamed", T1)]);

    expect(diffManifests(before, after).moved).toHaveLength(1);
    expect(diffManifests(before, after).added).toEqual([]);
  });

  it("reports a document that left the tree as removed", () => {
    const diff = diffManifests(before, buildManifest("d", "root", []));

    expect(diff.removed.map((entry) => entry.id)).toEqual(["d-1"]);
  });

  it("reports both a move and a content change when both happened", () => {
    const after = buildManifest("d", "root", [node("d-1", "corpus/generation/alpha", T2)]);
    const diff = diffManifests(before, after);

    expect(diff.moved).toHaveLength(1);
    expect(diff.contentChanged).toHaveLength(1);
  });
});

describe("summariseDiff", () => {
  it("reads as a one-line summary", () => {
    const diff = diffManifests(null, buildManifest("d", "root", [node("d-1", "corpus/a", T1)]));

    expect(summariseDiff(diff)).toBe("1 added, 0 changed, 0 moved, 0 removed");
  });
});

describe("manifest persistence", () => {
  it("round-trips through disk", async () => {
    const dir = await mkdtemp(join(tmpdir(), "manifest-"));
    const path = join(dir, "nested", "manifest.json");
    const manifest = buildManifest("d", "root", [node("d-1", "corpus/a", T1)]);

    await writeManifest(path, manifest);

    expect(await readManifest(path)).toEqual(manifest);
  });

  it("returns null on the first ever run", async () => {
    const dir = await mkdtemp(join(tmpdir(), "manifest-"));

    expect(await readManifest(join(dir, "absent.json"))).toBeNull();
  });
});
