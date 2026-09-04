import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { LabConfig } from "../config/config.js";
import { DRIVE_READONLY_SCOPE, driveClient } from "../drive/auth.js";
import { listChanges, startPageToken } from "../drive/changes.js";
import type { Logger } from "../logger.js";
import { writeLine } from "./output.js";

interface StoredToken {
  token: string;
}

/** `null` means there is no prior run to compare against yet. */
async function readStoredToken(path: string): Promise<string | null> {
  try {
    const raw = JSON.parse(await readFile(path, "utf8")) as StoredToken;
    return raw.token;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw err;
  }
}

async function writeStoredToken(path: string, token: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify({ token }, null, 2)}\n`, "utf8");
}

/**
 * Persists the page token across runs. Without that, every invocation would
 * start from a fresh token and list from it immediately — which always
 * reports zero changes, since nothing has happened between "get a token" and
 * "list from that same token" a moment later.
 */
export async function runChanges(config: LabConfig, logger: Logger): Promise<void> {
  try {
    logger.info({ driveId: config.driveId }, "Reading the Drive changes feed...");

    const drive = await driveClient(config, [DRIVE_READONLY_SCOPE]);
    const stored = await readStoredToken(config.changesTokenPath);
    const isFirstRun = stored === null;
    const token = stored ?? (await startPageToken(drive, config.driveId));

    if (isFirstRun) {
      writeLine("first run — no prior token to compare against yet, so nothing to report");
    }

    const { changes, newStartPageToken } = await listChanges(drive, config.driveId, token);
    await writeStoredToken(config.changesTokenPath, newStartPageToken);

    if (!isFirstRun) {
      writeLine(
        changes.length === 0
          ? "no changes since the last run — edit something in Drive and run this again"
          : `${changes.length} change(s):`,
      );
      for (const change of changes) {
        const kind = change.isFolder ? "folder" : "file";
        writeLine(
          `  - ${kind} ${change.name || change.fileId}${change.removed ? " (removed)" : ""}`,
        );
      }
    }

    logger.info({ count: changes.length, isFirstRun }, "Reading the Drive changes feed succeeded.");
  } catch (err) {
    logger.error({ err, driveId: config.driveId }, "Reading the Drive changes feed failed.");
    throw err;
  }
}
