/**
 * The verify command: grades one finished run against a task's hard
 * checks and reports process evidence from its transcript, writing
 * the result as a Verdict JSON file plus a human-readable summary on
 * stdout. It exits successfully whenever a verdict was written,
 * whether it passed or failed; only a failure to complete
 * verification itself (a missing run, a still-running run, an
 * unreadable transcript) is an error the caller must handle.
 */
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Logger } from "../logger.js";
import type { Style } from "../render/style.js";
import { readRunInfo } from "../run/run-info.js";
import { readTranscript } from "../transcript/reader.js";
import { runHardChecks } from "../verify/hard-checks.js";
import { analyzeTranscript } from "../verify/measured.js";
import type { RunStep } from "../verify/process.js";
import { readTaskConfig } from "../verify/task-config.js";
import {
  buildVerdict,
  formatSummary,
  type Verdict,
} from "../verify/verdict.js";
import { prepareWorkspace } from "../verify/workspace.js";

export interface VerifyArgs {
  runDir: string;
  acceptanceDir: string | null;
  outFile: string;
  scratchDir: string;
}

export interface VerifyDeps {
  logger: Logger;
  write: (text: string) => void;
  style: Style;
  runStep: RunStep;
}

/** Grades one run against its task's hard checks, writes its Verdict to outFile, and prints the summary. */
export async function verifyRun(
  args: VerifyArgs,
  deps: VerifyDeps,
): Promise<Verdict> {
  const { runDir, acceptanceDir, outFile, scratchDir } = args;
  const { logger, write, style, runStep } = deps;
  try {
    logger.info({ runDir, acceptanceDir }, "Verifying run...");
    const run = await readRunInfo(runDir);
    if (run.status !== "finished") {
      throw new Error(`run ${run.runId} is still in progress`);
    }
    const events = await readTranscript(join(runDir, "transcript.jsonl"));
    const config = acceptanceDir ? await readTaskConfig(acceptanceDir) : null;
    const workDir = await prepareWorkspace(
      join(runDir, "workspace"),
      scratchDir,
    );
    const hardChecks = await runHardChecks({
      run,
      workDir,
      acceptanceDir,
      runStep,
      logger,
    });
    const measured = analyzeTranscript(events, config?.programPattern ?? null);
    const verdict = buildVerdict(run, hardChecks, measured, new Date());
    await writeFile(outFile, `${JSON.stringify(verdict, null, 2)}\n`);
    write(formatSummary(verdict, style));
    logger.info(
      { runDir, verdict: verdict.verdict },
      "Verifying run succeeded.",
    );
    return verdict;
  } catch (err) {
    logger.error({ err, runDir }, "Verifying run failed.");
    throw err;
  }
}
