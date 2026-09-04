import { MOVED_DOCUMENT_NAMES, MOVED_FOLDER_NAME } from "../corpus/probes.js";
import { listChanges, startPageToken } from "../drive/changes.js";
import { moveFolder } from "../drive/mutate.js";
import { childLister, findChildFolder } from "../drive/tree.js";
import { listIndexedDocumentIds } from "../search/import.js";
import { type Check, checkCount, checkIdsAbsent, checkIdsPresent } from "./checks.js";
import { idOf, type VerifyContext } from "./stages.js";

/** The folder the move test relocates, found by name among the corpus root's children. */
async function findMovedFolderId(context: VerifyContext): Promise<string | null> {
  const list = childLister(context.drive, context.config.driveId);
  const folder = await findChildFolder(list, context.corpusId, MOVED_FOLDER_NAME);
  return folder?.id ?? null;
}

/**
 * Assertion 5: a moved subfolder does not go stale, and the changes feed misses it.
 *
 * The folder is moved back in `finally`, so a thrown error partway through
 * (a failed resync, a failed changes listing) still restores the Drive layout
 * before the error propagates. Without that guarantee `evaluation/` would be
 * left stranded inside `archive/`, and the next run's `findMovedFolderId`
 * would fail with no recovery short of moving it back in Drive by hand.
 */
export async function verifyMove(context: VerifyContext): Promise<Check[]> {
  const movedIds = MOVED_DOCUMENT_NAMES.map((name) => idOf(context.manifest, name));
  const folder = await findMovedFolderId(context);
  if (folder === null) {
    throw new Error(`Could not find the ${MOVED_FOLDER_NAME}/ folder to move.`);
  }

  const token = await startPageToken(context.drive, context.config.driveId);
  await moveFolder(context.drive, folder, context.corpusId, context.archiveId);

  const checks: Check[] = [];
  try {
    const { changes } = await listChanges(context.drive, context.config.driveId, token);
    const manifest = await context.resync("FULL");
    const indexed = await listIndexedDocumentIds(context.documents, context.branch);

    checks.push(
      checkIdsAbsent("the moved documents left the data store", indexed, movedIds),
      checkCount(
        "the data store shrank by the moved folder",
        indexed.length,
        manifest.entries.length,
      ),
      checkIdsPresent(
        "the changes feed reported the folder",
        changes.filter((change) => change.isFolder).map((change) => change.fileId),
        [folder],
      ),
      checkIdsAbsent(
        "the changes feed said nothing about the files inside it",
        changes.map((change) => change.fileId),
        movedIds,
      ),
    );
  } finally {
    // Put the folder back so the run is repeatable, even if the checks above threw.
    await moveFolder(context.drive, folder, context.archiveId, context.corpusId);
    await context.resync("FULL");
    const restoredIndexed = await listIndexedDocumentIds(context.documents, context.branch);
    checks.push(
      checkIdsPresent("moving the folder back restores every document", restoredIndexed, movedIds),
    );
  }

  return checks;
}
