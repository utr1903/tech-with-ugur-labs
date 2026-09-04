import type { docs_v1 } from "@googleapis/docs";
import type { drive_v3 } from "@googleapis/drive";

/**
 * Editing a Doc's text the way a person would, but scriptable. Returns how many
 * occurrences were replaced so the caller can assert the edit really happened.
 */
export async function replaceTextInDoc(
  docs: docs_v1.Docs,
  documentId: string,
  from: string,
  to: string,
): Promise<number> {
  const { data } = await docs.documents.batchUpdate({
    documentId,
    requestBody: {
      requests: [
        { replaceAllText: { containsText: { text: from, matchCase: true }, replaceText: to } },
      ],
    },
  });
  return data.replies?.[0]?.replaceAllText?.occurrencesChanged ?? 0;
}

/**
 * A file in a shared drive has exactly one parent, so a move is a clean swap.
 * Moving a folder needs Content manager — Contributor cannot do it.
 */
export async function moveFolder(
  drive: drive_v3.Drive,
  folderId: string,
  fromParentId: string,
  toParentId: string,
): Promise<void> {
  await drive.files.update({
    fileId: folderId,
    addParents: toParentId,
    removeParents: fromParentId,
    supportsAllDrives: true,
    fields: "id, parents",
  });
}
