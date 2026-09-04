import { FRESHNESS_PROBE } from "../corpus/probes.js";
import { replaceTextInDoc } from "../drive/mutate.js";
import { askQuestion } from "../search/answer.js";
import { stagedUri } from "../storage/stage.js";
import {
  type Check,
  checkCitesDocument,
  checkContainsFact,
  checkCount,
  checkExactly,
  checkOmitsFact,
} from "./checks.js";
import { idOf, type VerifyContext } from "./stages.js";

/**
 * Assertion 4: an edit in Drive changes the answer.
 *
 * The document is put back in `finally`, so a thrown error partway through
 * (a failed resync, a failed ask) still restores the original value before
 * the error propagates. Losing that guarantee would leave the canary fact
 * permanently swapped, which is self-healing on the next `npm run verify`
 * but confusing until then.
 */
export async function verifyFreshness(context: VerifyContext): Promise<Check[]> {
  const driveFileId = idOf(context.manifest, FRESHNESS_PROBE.docName);
  const expectedUri = stagedUri(context.config.bucket, driveFileId);
  const replaced = await replaceTextInDoc(
    context.docs,
    driveFileId,
    FRESHNESS_PROBE.original,
    FRESHNESS_PROBE.replacement,
  );

  const checks: Check[] = [checkCount("the edit replaced exactly one occurrence", replaced, 1)];

  try {
    const manifest = await context.resync("INCREMENTAL");
    const result = await askQuestion(
      context.conversational,
      context.servingConfig,
      FRESHNESS_PROBE.question,
      {},
      context.logger,
    );

    checks.push(
      checkContainsFact("the new value is answerable", result, FRESHNESS_PROBE.replacement),
      checkOmitsFact("the superseded value is gone", result, FRESHNESS_PROBE.original),
      checkCitesDocument("the answer still cites the same document", result, expectedUri),
      checkExactly(
        "the document id did not change across the edit",
        [idOf(manifest, FRESHNESS_PROBE.docName)],
        [driveFileId],
      ),
    );
  } finally {
    // Put the document back so the run is repeatable, even if the checks above threw.
    const restored = await replaceTextInDoc(
      context.docs,
      driveFileId,
      FRESHNESS_PROBE.replacement,
      FRESHNESS_PROBE.original,
    );
    await context.resync("INCREMENTAL");
    checks.push(checkCount("the restore replaced exactly one occurrence", restored, 1));
  }

  return checks;
}
