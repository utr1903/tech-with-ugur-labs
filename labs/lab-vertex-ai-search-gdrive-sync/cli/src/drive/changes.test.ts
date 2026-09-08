import { describe, expect, it } from "vitest";
import { shapeChange } from "./changes.js";
import { DOC_MIME_TYPE, FOLDER_MIME_TYPE } from "./tree.js";

describe("shapeChange", () => {
  it("reads a document change, including its new parents", () => {
    const change = shapeChange({
      fileId: "d-1",
      removed: false,
      file: {
        id: "d-1",
        name: "chunking-strategies",
        mimeType: DOC_MIME_TYPE,
        parents: ["f-generation"],
      },
    });

    expect(change).toEqual({
      fileId: "d-1",
      name: "chunking-strategies",
      removed: false,
      isFolder: false,
      parents: ["f-generation"],
    });
  });

  it("marks a folder change as a folder", () => {
    const change = shapeChange({
      fileId: "f-1",
      removed: false,
      file: { id: "f-1", name: "evaluation", mimeType: FOLDER_MIME_TYPE, parents: ["f-archive"] },
    });

    expect(change.isFolder).toBe(true);
    expect(change.parents).toEqual(["f-archive"]);
  });

  it("survives a removal, where the file resource is gone", () => {
    const change = shapeChange({ fileId: "d-9", removed: true });

    expect(change).toEqual({
      fileId: "d-9",
      name: "",
      removed: true,
      isFolder: false,
      parents: [],
    });
  });

  it("treats a trashed file as removed", () => {
    const change = shapeChange({
      fileId: "d-2",
      removed: false,
      file: { id: "d-2", name: "x", mimeType: DOC_MIME_TYPE, trashed: true, parents: [] },
    });

    expect(change.removed).toBe(true);
  });
});
