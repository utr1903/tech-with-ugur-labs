import type { LabConfig } from "../config/config.js";
import { loadSources } from "../corpus/sources.js";
import { DRIVE_WRITE_SCOPE, driveClient } from "../drive/auth.js";
import {
  driveDocUploader,
  driveFolderEnsurer,
  ensureFolder,
  seedDocuments,
} from "../drive/seed.js";
import { ARCHIVE_FOLDER_NAME, CORPUS_FOLDER_NAME } from "../drive/tree.js";
import type { Logger } from "../logger.js";
import { writeLine } from "./output.js";

export async function runSeed(config: LabConfig, logger: Logger): Promise<void> {
  try {
    logger.info({ driveId: config.driveId }, "Seeding the shared drive...");

    const sources = await loadSources(config.corpusDir);
    const drive = await driveClient(config, [DRIVE_WRITE_SCOPE]);
    const ensurer = driveFolderEnsurer(drive, config.driveId);

    const corpusId = await ensureFolder(ensurer, config.driveId, CORPUS_FOLDER_NAME);
    await ensureFolder(ensurer, config.driveId, ARCHIVE_FOLDER_NAME);

    const folderIds = new Map<string, string>();
    for (const folder of new Set(sources.map((source) => source.folder))) {
      folderIds.set(folder, await ensureFolder(ensurer, corpusId, folder));
    }

    const result = await seedDocuments(driveDocUploader(drive, config.driveId), folderIds, sources);

    logger.info(
      { created: result.created.length, existing: result.existing.length },
      "Seeding the shared drive succeeded.",
    );
    writeLine(
      `Seeded ${result.created.length} documents (${result.existing.length} already there).`,
    );
  } catch (err) {
    logger.error({ err, driveId: config.driveId }, "Seeding the shared drive failed.");
    throw err;
  }
}
