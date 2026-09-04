import type { drive_v3 } from "@googleapis/drive";

export const FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";
export const DOC_MIME_TYPE = "application/vnd.google-apps.document";
export const CORPUS_FOLDER_NAME = "corpus";
export const ARCHIVE_FOLDER_NAME = "archive";

export interface DriveEntry {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  parents: string[];
}

export interface DriveNode extends DriveEntry {
  path: string;
  isFolder: boolean;
}

export type ChildLister = (parentId: string) => Promise<DriveEntry[]>;

export function isFolder(entry: DriveEntry): boolean {
  return entry.mimeType === FOLDER_MIME_TYPE;
}

/**
 * Drive's query syntax has no recursive form — `'<id>' in parents` matches one
 * level only — so a tree is a walk, one listing per folder.
 */
export async function walkTree(
  list: ChildLister,
  rootId: string,
  rootPath: string,
): Promise<DriveNode[]> {
  const nodes: DriveNode[] = [];
  const seen = new Set<string>([rootId]);
  const queue: Array<{ id: string; path: string }> = [{ id: rootId, path: rootPath }];

  while (queue.length > 0) {
    const folder = queue.shift();
    if (folder === undefined) {
      break;
    }
    for (const entry of await list(folder.id)) {
      if (seen.has(entry.id)) {
        continue;
      }
      seen.add(entry.id);
      const path = `${folder.path}/${entry.name}`;
      const folderish = isFolder(entry);
      nodes.push({ ...entry, path, isFolder: folderish });
      if (folderish) {
        queue.push({ id: entry.id, path });
      }
    }
  }

  return nodes;
}

export function documentsOf(nodes: DriveNode[]): DriveNode[] {
  return nodes.filter((node) => !node.isFolder);
}

export async function findChildFolder(
  list: ChildLister,
  parentId: string,
  name: string,
): Promise<DriveEntry | null> {
  const children = await list(parentId);
  return children.find((child) => isFolder(child) && child.name === name) ?? null;
}

const LIST_FIELDS = "nextPageToken, files(id, name, mimeType, modifiedTime, parents)";

/**
 * Every shared-drive listing needs all four of these. Omit any one and the API
 * returns an empty page instead of an error, which looks exactly like an empty
 * folder.
 */
export function childLister(drive: drive_v3.Drive, driveId: string): ChildLister {
  return async (parentId) => {
    const entries: DriveEntry[] = [];
    let pageToken: string | undefined;

    do {
      const { data } = await drive.files.list({
        q: `'${parentId}' in parents and trashed = false`,
        driveId,
        corpora: "drive",
        includeItemsFromAllDrives: true,
        supportsAllDrives: true,
        fields: LIST_FIELDS,
        pageSize: 100,
        pageToken,
      });
      for (const file of data.files ?? []) {
        entries.push({
          id: file.id ?? "",
          name: file.name ?? "",
          mimeType: file.mimeType ?? "",
          modifiedTime: file.modifiedTime ?? "",
          parents: file.parents ?? [],
        });
      }
      pageToken = data.nextPageToken ?? undefined;
    } while (pageToken !== undefined);

    return entries;
  };
}
