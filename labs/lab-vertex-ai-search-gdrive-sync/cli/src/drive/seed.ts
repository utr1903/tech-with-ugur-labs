import type { drive_v3 } from "@googleapis/drive";
import type { SourceDocument } from "../corpus/sources.js";
import { DOC_MIME_TYPE, FOLDER_MIME_TYPE } from "./tree.js";

/**
 * Set from Task 7 Step 1: the probe deciding between "text/markdown" and
 * "text/html" was not run (see the lab README / pipeline run notes for why),
 * so this takes the brief's named default, "text/markdown", uploaded as the
 * media body directly. Revisit only if the real seed run rejects the import.
 */
export const SEED_MIME_TYPE = "text/markdown";

export interface FolderEnsurer {
  find(parentId: string, name: string): Promise<string | null>;
  create(parentId: string, name: string): Promise<string>;
}

export interface DocUploader {
  find(parentId: string, name: string): Promise<string | null>;
  create(parentId: string, name: string, body: string): Promise<string>;
}

export async function ensureFolder(
  ensurer: FolderEnsurer,
  parentId: string,
  name: string,
): Promise<string> {
  return (await ensurer.find(parentId, name)) ?? (await ensurer.create(parentId, name));
}

export async function seedDocuments(
  uploader: DocUploader,
  folderIds: Map<string, string>,
  sources: SourceDocument[],
): Promise<{ created: string[]; existing: string[] }> {
  const created: string[] = [];
  const existing: string[] = [];

  for (const source of sources) {
    const parentId = folderIds.get(source.folder);
    if (parentId === undefined) {
      throw new Error(`No Drive folder was created for ${source.folder}.`);
    }
    if ((await uploader.find(parentId, source.name)) !== null) {
      existing.push(source.id);
      continue;
    }
    await uploader.create(parentId, source.name, source.body);
    created.push(source.id);
  }

  return { created, existing };
}

function escapeQuotes(name: string): string {
  return name.replace(/'/g, "\\'");
}

async function findByName(
  drive: drive_v3.Drive,
  driveId: string,
  parentId: string,
  name: string,
  mimeType: string,
): Promise<string | null> {
  const { data } = await drive.files.list({
    q: `'${parentId}' in parents and name = '${escapeQuotes(name)}' and mimeType = '${mimeType}' and trashed = false`,
    driveId,
    corpora: "drive",
    includeItemsFromAllDrives: true,
    supportsAllDrives: true,
    fields: "files(id)",
    pageSize: 1,
  });
  return data.files?.[0]?.id ?? null;
}

export function driveFolderEnsurer(drive: drive_v3.Drive, driveId: string): FolderEnsurer {
  return {
    find: (parentId, name) => findByName(drive, driveId, parentId, name, FOLDER_MIME_TYPE),
    create: async (parentId, name) => {
      const { data } = await drive.files.create({
        supportsAllDrives: true,
        fields: "id",
        requestBody: { name, mimeType: FOLDER_MIME_TYPE, parents: [parentId] },
      });
      if (data.id === null || data.id === undefined) {
        throw new Error(`Drive did not return an id for the new folder ${name}.`);
      }
      return data.id;
    },
  };
}

/**
 * The Doc is created by the service account but owned by the shared drive, which
 * is the only reason this works: a service account has no storage quota of its
 * own and cannot own files.
 */
export function driveDocUploader(drive: drive_v3.Drive, driveId: string): DocUploader {
  return {
    find: (parentId, name) => findByName(drive, driveId, parentId, name, DOC_MIME_TYPE),
    create: async (parentId, name, body) => {
      const { data } = await drive.files.create({
        supportsAllDrives: true,
        fields: "id",
        requestBody: { name, mimeType: DOC_MIME_TYPE, parents: [parentId] },
        media: { mimeType: SEED_MIME_TYPE, body },
      });
      if (data.id === null || data.id === undefined) {
        throw new Error(`Drive did not return an id for the new document ${name}.`);
      }
      return data.id;
    },
  };
}
