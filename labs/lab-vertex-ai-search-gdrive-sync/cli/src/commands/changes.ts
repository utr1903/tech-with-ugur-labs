import type { LabConfig } from "../config/config.js";
import { DRIVE_READONLY_SCOPE, driveClient } from "../drive/auth.js";
import { listChanges, startPageToken } from "../drive/changes.js";
import type { Logger } from "../logger.js";
import { writeLine } from "./output.js";

export async function runChanges(config: LabConfig, logger: Logger): Promise<void> {
  try {
    logger.info({ driveId: config.driveId }, "Reading the Drive changes feed...");

    const drive = await driveClient(config, [DRIVE_READONLY_SCOPE]);
    const token = await startPageToken(drive, config.driveId);
    const { changes } = await listChanges(drive, config.driveId, token);

    writeLine(`start page token: ${token}`);
    writeLine(
      changes.length === 0
        ? "no changes since that token — edit something in Drive and run this again"
        : `${changes.length} change(s):`,
    );
    for (const change of changes) {
      const kind = change.isFolder ? "folder" : "file";
      writeLine(`  - ${kind} ${change.name || change.fileId}${change.removed ? " (removed)" : ""}`);
    }

    logger.info({ count: changes.length }, "Reading the Drive changes feed succeeded.");
  } catch (err) {
    logger.error({ err, driveId: config.driveId }, "Reading the Drive changes feed failed.");
    throw err;
  }
}
