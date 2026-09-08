import type {
  ConversationalSearchServiceClient,
  DocumentServiceClient,
} from "@google-cloud/discoveryengine";
import type { docs_v1 } from "@googleapis/docs";
import type { drive_v3 } from "@googleapis/drive";
import type { LabConfig } from "../config/config.js";
import type { Manifest } from "../drive/manifest.js";
import type { Logger } from "../logger.js";
import type { AnswerResult } from "../search/answer.js";

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

/** Shared by all three stages: look up a corpus document's Drive file id by name. */
export function idOf(manifest: Manifest, docName: string): string {
  const entry = manifest.entries.find((candidate) => candidate.name === docName);
  if (entry === undefined) {
    throw new Error(`The manifest has no document named ${docName}; run npm run sync first.`);
  }
  return entry.id;
}

/** Performs one ask, via whatever means the caller already has set up. */
type Asker = () => Promise<AnswerResult>;

const DEFAULT_ASK_UNTIL_ATTEMPTS = 5;
const DEFAULT_ASK_UNTIL_INTERVAL_MS = 15_000;

/**
 * Import and `waitForDocumentCount` only prove a document is *present*; they
 * cannot prove a re-index of its *content* finished, since the count doesn't
 * change on an edit or a move. The first ask right after a resync can race
 * that re-index and see stale content — not a gRPC error, so `withRetry`
 * would not help. Retrying the ask itself, against a caller-supplied
 * predicate, is what actually waits out the race. Always returns the last
 * result, even when the predicate never held, so the caller's own check
 * still fails a genuine problem instead of this helper swallowing it.
 */
export async function askUntil(
  ask: Asker,
  predicate: (result: AnswerResult) => boolean,
  logger: Logger,
  options: { attempts: number; intervalMs: number } = {
    attempts: DEFAULT_ASK_UNTIL_ATTEMPTS,
    intervalMs: DEFAULT_ASK_UNTIL_INTERVAL_MS,
  },
): Promise<AnswerResult> {
  let result = await ask();

  for (let attempt = 1; attempt < options.attempts && !predicate(result); attempt += 1) {
    logger.warn(
      { attempt, intervalMs: options.intervalMs },
      "Answer did not match yet; retrying the ask...",
    );
    await new Promise((resolve) => setTimeout(resolve, options.intervalMs));
    result = await ask();
  }

  return result;
}

export { verifyBaseline } from "./baseline.js";
export { verifyFreshness } from "./freshness.js";
export { verifyMove } from "./move.js";
