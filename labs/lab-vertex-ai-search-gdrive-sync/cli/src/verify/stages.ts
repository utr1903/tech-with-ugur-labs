import type {
  ConversationalSearchServiceClient,
  DocumentServiceClient,
} from "@google-cloud/discoveryengine";
import type { docs_v1 } from "@googleapis/docs";
import type { drive_v3 } from "@googleapis/drive";
import type { LabConfig } from "../config/config.js";
import type { Manifest } from "../drive/manifest.js";
import type { Logger } from "../logger.js";

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

export { verifyBaseline } from "./baseline.js";
export { verifyFreshness } from "./freshness.js";
export { verifyMove } from "./move.js";
