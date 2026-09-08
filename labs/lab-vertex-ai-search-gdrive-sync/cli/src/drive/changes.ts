import type { drive_v3 } from "@googleapis/drive";
import { FOLDER_MIME_TYPE } from "./tree.js";

export interface DriveChange {
  fileId: string;
  name: string;
  removed: boolean;
  isFolder: boolean;
  parents: string[];
}

interface RawChange {
  fileId?: string | null;
  removed?: boolean | null;
  file?: {
    name?: string | null;
    mimeType?: string | null;
    trashed?: boolean | null;
    parents?: string[] | null;
  } | null;
}

export function shapeChange(raw: unknown): DriveChange {
  const change = (raw ?? {}) as RawChange;
  const file = change.file ?? null;
  return {
    fileId: change.fileId ?? "",
    name: file?.name ?? "",
    removed: change.removed === true || file?.trashed === true,
    isFolder: file?.mimeType === FOLDER_MIME_TYPE,
    parents: file?.parents ?? [],
  };
}

const CHANGE_FIELDS =
  "newStartPageToken, nextPageToken, changes(fileId, removed, file(id, name, mimeType, trashed, parents))";

export async function startPageToken(drive: drive_v3.Drive, driveId: string): Promise<string> {
  const { data } = await drive.changes.getStartPageToken({
    driveId,
    supportsAllDrives: true,
  });
  if (data.startPageToken === null || data.startPageToken === undefined) {
    throw new Error("Drive did not return a start page token.");
  }
  return data.startPageToken;
}

/**
 * The feed is drive-wide, not folder-scoped, so callers must re-resolve which
 * changes fall inside the corpus. `restrictToMyDrive` must stay false: it "omits
 * ... shared files which have not been added to My Drive", and for a service
 * account the corpus is exactly that.
 */
export async function listChanges(
  drive: drive_v3.Drive,
  driveId: string,
  pageToken: string,
): Promise<{ changes: DriveChange[]; newStartPageToken: string }> {
  const changes: DriveChange[] = [];
  let token: string = pageToken;
  let newStartPageToken = pageToken;

  for (;;) {
    const { data } = await drive.changes.list({
      driveId,
      pageToken: token,
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
      includeRemoved: true,
      restrictToMyDrive: false,
      fields: CHANGE_FIELDS,
      pageSize: 100,
    });

    for (const raw of data.changes ?? []) {
      changes.push(shapeChange(raw));
    }

    if (data.nextPageToken !== null && data.nextPageToken !== undefined) {
      token = data.nextPageToken;
      continue;
    }
    newStartPageToken = data.newStartPageToken ?? token;
    break;
  }

  return { changes, newStartPageToken };
}
