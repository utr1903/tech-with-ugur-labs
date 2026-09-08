import type { drive_v3 } from "@googleapis/drive";
import { branchPath, type LabConfig } from "../config/config.js";
import { applicationAuth, DRIVE_READONLY_SCOPE, driveClient } from "../drive/auth.js";
import { exportDocAsMarkdown } from "../drive/export.js";
import {
  buildManifest,
  diffManifests,
  type ManifestDiff,
  readManifest,
  summariseDiff,
  writeManifest,
} from "../drive/manifest.js";
import {
  ARCHIVE_FOLDER_NAME,
  CORPUS_FOLDER_NAME,
  childLister,
  DOC_MIME_TYPE,
  findChildFolder,
  walkTree,
} from "../drive/tree.js";
import type { Logger } from "../logger.js";
import { documentClient } from "../search/clients.js";
import { importStaged, waitForDocumentCount } from "../search/import.js";
import {
  jsonApiWriter,
  metadataUri,
  type StagedDocument,
  stageDocuments,
} from "../storage/stage.js";
import { writeLine } from "./output.js";

const INDEXING_TIMEOUT_MS = 15 * 60 * 1000;
const INDEXING_POLL_INTERVAL_MS = 15 * 1000;

/**
 * The service account reaches the corpus through a Drive share, so a wrong or
 * stale address surfaces as an empty listing rather than a permission error.
 * Checking the fixture up front turns that into a message that says what to fix.
 */
export async function resolveFixture(
  drive: drive_v3.Drive,
  config: LabConfig,
  logger: Logger,
): Promise<{ corpusId: string; archiveId: string }> {
  const list = childLister(drive, config.driveId);
  const corpus = await findChildFolder(list, config.driveId, CORPUS_FOLDER_NAME);
  const archive = await findChildFolder(list, config.driveId, ARCHIVE_FOLDER_NAME);

  if (corpus === null || archive === null) {
    throw new Error(
      `Shared drive ${config.driveId} has no ${corpus === null ? CORPUS_FOLDER_NAME : ARCHIVE_FOLDER_NAME}/ folder. ` +
        `Check that ${config.syncServiceAccount} is a Content manager on the shared drive, then run npm run seed.`,
    );
  }

  logger.info({ corpusId: corpus.id, archiveId: archive.id }, "Resolved the Drive fixture.");
  return { corpusId: corpus.id, archiveId: archive.id };
}

export async function runSync(
  config: LabConfig,
  options: { mode: "FULL" | "INCREMENTAL" },
  logger: Logger,
): Promise<ManifestDiff> {
  try {
    logger.info({ driveId: config.driveId, mode: options.mode }, "Syncing the corpus...");

    const drive = await driveClient(config, [DRIVE_READONLY_SCOPE]);
    const { corpusId } = await resolveFixture(drive, config, logger);
    const nodes = await walkTree(childLister(drive, config.driveId), corpusId, CORPUS_FOLDER_NAME);

    const staged: StagedDocument[] = [];
    for (const node of nodes) {
      if (node.isFolder) {
        continue;
      }
      if (node.mimeType !== DOC_MIME_TYPE) {
        logger.warn(
          { path: node.path, mimeType: node.mimeType },
          "Skipping a non-Google-Doc file found in the corpus.",
        );
        continue;
      }
      staged.push({
        driveFileId: node.id,
        path: node.path,
        title: node.name,
        markdown: await exportDocAsMarkdown(drive, node.id),
      });
    }

    await stageDocuments(
      jsonApiWriter(applicationAuth(), config.bucket),
      staged,
      config.bucket,
      logger,
    );

    const client = documentClient(config);
    const branch = branchPath(config);
    await importStaged(client, branch, metadataUri(config.bucket), options.mode, logger);
    await waitForDocumentCount(
      client,
      branch,
      staged.length,
      { timeoutMs: INDEXING_TIMEOUT_MS, intervalMs: INDEXING_POLL_INTERVAL_MS },
      logger,
    );

    const next = buildManifest(config.driveId, corpusId, nodes);
    const diff = diffManifests(await readManifest(config.statePath), next);
    await writeManifest(config.statePath, next);

    logger.info(
      { documentCount: staged.length, diff: summariseDiff(diff) },
      "Syncing the corpus succeeded.",
    );
    writeLine(`Synced ${staged.length} documents — ${summariseDiff(diff)}.`);
    return diff;
  } catch (err) {
    logger.error({ err, driveId: config.driveId }, "Syncing the corpus failed.");
    throw err;
  }
}
