import { POSITIVE_PROBES } from "../corpus/probes.js";
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
  checkOmitsFact,
} from "./checks.js";
import { idOf, type VerifyContext } from "./stages.js";

const GROUNDING_THRESHOLD = Number(process.env.GROUNDING_THRESHOLD ?? 0.6);

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
