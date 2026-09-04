import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { type DriveNode, documentsOf } from "./tree.js";

export interface ManifestEntry {
  id: string;
  path: string;
  name: string;
  modifiedTime: string;
}

export interface Manifest {
  driveId: string;
  rootId: string;
  entries: ManifestEntry[];
}

export interface ManifestDiff {
  added: ManifestEntry[];
  contentChanged: ManifestEntry[];
  moved: Array<{ entry: ManifestEntry; from: string }>;
  removed: ManifestEntry[];
}

export function buildManifest(driveId: string, rootId: string, nodes: DriveNode[]): Manifest {
  const entries = documentsOf(nodes)
    .map((node) => ({
      id: node.id,
      path: node.path,
      name: node.name,
      modifiedTime: node.modifiedTime,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));

  return { driveId, rootId, entries };
}

/**
 * The whole point of keying on the Drive file id: a move or a rename changes the
 * path, a real edit changes modifiedTime, and the two are independent. Only a
 * content change costs an ingest.
 */
export function diffManifests(previous: Manifest | null, next: Manifest): ManifestDiff {
  const before = new Map((previous?.entries ?? []).map((entry) => [entry.id, entry]));
  const diff: ManifestDiff = { added: [], contentChanged: [], moved: [], removed: [] };

  for (const entry of next.entries) {
    const old = before.get(entry.id);
    if (old === undefined) {
      diff.added.push(entry);
      continue;
    }
    if (old.modifiedTime !== entry.modifiedTime) {
      diff.contentChanged.push(entry);
    }
    if (old.path !== entry.path) {
      diff.moved.push({ entry, from: old.path });
    }
  }

  const now = new Set(next.entries.map((entry) => entry.id));
  for (const entry of before.values()) {
    if (!now.has(entry.id)) {
      diff.removed.push(entry);
    }
  }

  return diff;
}

export function summariseDiff(diff: ManifestDiff): string {
  return [
    `${diff.added.length} added`,
    `${diff.contentChanged.length} changed`,
    `${diff.moved.length} moved`,
    `${diff.removed.length} removed`,
  ].join(", ");
}

export async function readManifest(path: string): Promise<Manifest | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as Manifest;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw err;
  }
}

export async function writeManifest(path: string, manifest: Manifest): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}
