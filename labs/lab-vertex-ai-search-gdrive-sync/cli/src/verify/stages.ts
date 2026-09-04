import type {
  ConversationalSearchServiceClient,
  DocumentServiceClient,
} from "@google-cloud/discoveryengine";
import type { docs_v1 } from "@googleapis/docs";
import type { drive_v3 } from "@googleapis/drive";
import type { LabConfig } from "../config/config.js";
import {
  FRESHNESS_PROBE,
  MOVED_DOCUMENT_NAMES,
  MOVED_FOLDER_NAME,
  POSITIVE_PROBES,
} from "../corpus/probes.js";
import { listChanges, startPageToken } from "../drive/changes.js";
import type { Manifest } from "../drive/manifest.js";
import { moveFolder, replaceTextInDoc } from "../drive/mutate.js";
import { childLister, findChildFolder } from "../drive/tree.js";
import type { Logger } from "../logger.js";
import { askQuestion } from "../search/answer.js";
import { listIndexedDocumentIds } from "../search/import.js";
import { stagedUri } from "../storage/stage.js";
import {
  type Check,
  checkCitesDocument,
  checkContainsFact,
  checkCount,
  checkExactly,
  checkGrounded,
  checkIdsAbsent,
  checkIdsPresent,
  checkOmitsFact,
} from "./checks.js";

const GROUNDING_THRESHOLD = Number(process.env.GROUNDING_THRESHOLD ?? 0.6);

export interface VerifyContext {
  config: LabConfig;
  drive: drive_v3.Drive;
  docs: docs_v1.Docs;
  documents: DocumentServiceClient;
  conversational: ConversationalSearchServiceClient;
  servingConfig: string;
  branch: string;
  manifest: Manifest;
  corpusId: string;
  archiveId: string;
  resync: (mode: "FULL" | "INCREMENTAL") => Promise<Manifest>;
  logger: Logger;
}

function idOf(manifest: Manifest, docName: string): string {
  const entry = manifest.entries.find((candidate) => candidate.name === docName);
  if (entry === undefined) {
    throw new Error(`The manifest has no document named ${docName}; run npm run sync first.`);
  }
  return entry.id;
}

/** Assertions 1–3: the tree landed, the canaries answer, and retrieval is doing the work. */
export async function verifyBaseline(context: VerifyContext): Promise<Check[]> {
  const indexed = await listIndexedDocumentIds(context.documents, context.branch);
  const expectedIds = context.manifest.entries.map((entry) => entry.id);
  const checks: Check[] = [
    checkCount("documents indexed", indexed.length, expectedIds.length),
    checkExactly("every document id is a Drive file id", indexed, expectedIds),
  ];

  for (const probe of POSITIVE_PROBES) {
    const driveFileId = idOf(context.manifest, probe.docName);
    const expectedUri = stagedUri(context.config.bucket, driveFileId);
    const result = await askQuestion(
      context.conversational,
      context.servingConfig,
      probe.question,
      {},
      context.logger,
    );
    checks.push(
      checkContainsFact(`${probe.docName}: answer carries the invented fact`, result, probe.fact),
      checkCitesDocument(`${probe.docName}: cites its Drive document`, result, expectedUri),
      checkGrounded(`${probe.docName}: answer is grounded`, result, GROUNDING_THRESHOLD),
    );
  }

  for (const probe of POSITIVE_PROBES) {
    const result = await askQuestion(
      context.conversational,
      context.servingConfig,
      probe.question,
      { withoutRetrieval: true },
      context.logger,
    );
    checks.push(
      checkOmitsFact(`${probe.docName}: the fact is unknown without retrieval`, result, probe.fact),
    );
  }

  return checks;
}

/** Assertion 4: an edit in Drive changes the answer. */
export async function verifyFreshness(context: VerifyContext): Promise<Check[]> {
  const driveFileId = idOf(context.manifest, FRESHNESS_PROBE.docName);
  const expectedUri = stagedUri(context.config.bucket, driveFileId);
  const replaced = await replaceTextInDoc(
    context.docs,
    driveFileId,
    FRESHNESS_PROBE.original,
    FRESHNESS_PROBE.replacement,
  );

  const manifest = await context.resync("INCREMENTAL");
  const result = await askQuestion(
    context.conversational,
    context.servingConfig,
    FRESHNESS_PROBE.question,
    {},
    context.logger,
  );

  const checks: Check[] = [
    checkCount("the edit replaced exactly one occurrence", replaced, 1),
    checkContainsFact("the new value is answerable", result, FRESHNESS_PROBE.replacement),
    checkOmitsFact("the superseded value is gone", result, FRESHNESS_PROBE.original),
    checkCitesDocument("the answer still cites the same document", result, expectedUri),
    checkExactly(
      "the document id did not change across the edit",
      [idOf(manifest, FRESHNESS_PROBE.docName)],
      [driveFileId],
    ),
  ];

  // Put the document back so the run is repeatable.
  await replaceTextInDoc(
    context.docs,
    driveFileId,
    FRESHNESS_PROBE.replacement,
    FRESHNESS_PROBE.original,
  );
  await context.resync("INCREMENTAL");

  return checks;
}

/** The folder the move test relocates, found by name among the corpus root's children. */
async function findMovedFolderId(context: VerifyContext): Promise<string | null> {
  const list = childLister(context.drive, context.config.driveId);
  const folder = await findChildFolder(list, context.corpusId, MOVED_FOLDER_NAME);
  return folder?.id ?? null;
}

/** Assertion 5: a moved subfolder does not go stale, and the changes feed misses it. */
export async function verifyMove(context: VerifyContext): Promise<Check[]> {
  const movedIds = MOVED_DOCUMENT_NAMES.map((name) => idOf(context.manifest, name));
  const folder = await findMovedFolderId(context);
  if (folder === null) {
    throw new Error(`Could not find the ${MOVED_FOLDER_NAME}/ folder to move.`);
  }

  const token = await startPageToken(context.drive, context.config.driveId);
  await moveFolder(context.drive, folder, context.corpusId, context.archiveId);
  const { changes } = await listChanges(context.drive, context.config.driveId, token);

  const manifest = await context.resync("FULL");
  const indexed = await listIndexedDocumentIds(context.documents, context.branch);

  const checks: Check[] = [
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
  ];

  // Put the folder back so the run is repeatable.
  await moveFolder(context.drive, folder, context.archiveId, context.corpusId);
  const restored = await context.resync("FULL");
  checks.push(
    checkIdsPresent(
      "moving the folder back restores every document",
      restored.entries.map((entry) => entry.id),
      movedIds,
    ),
  );

  return checks;
}
