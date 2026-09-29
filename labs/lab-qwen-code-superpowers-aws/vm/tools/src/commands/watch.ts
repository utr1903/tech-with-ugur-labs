/**
 * Follows a run directory while the agent is still working: waits for
 * run.json to appear, then renders every transcript line as it's
 * appended until the run's status flips to "finished". If run.json
 * already says "finished" the moment watching starts, there is nothing
 * left to follow, so this defers to the replay path (no live elapsed
 * clock, no polling) instead of rendering the whole transcript at once
 * with every turn line showing "now minus startedAt".
 */
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import type { Logger } from "../logger.js";
import { createRenderer } from "../render/renderer.js";
import type { Style } from "../render/style.js";
import { type RunInfo, readRunInfo } from "../run/run-info.js";
import { followTranscript } from "../transcript/reader.js";
import { replayRun } from "./replay.js";

const RUN_JSON_TIMEOUT_MS = 60_000;
const POLL_MS = 500;

/** Polls for run.json to appear, giving up after RUN_JSON_TIMEOUT_MS. */
async function waitForRunInfo(runDir: string): Promise<RunInfo> {
  const deadline = Date.now() + RUN_JSON_TIMEOUT_MS;
  for (;;) {
    try {
      return await readRunInfo(runDir);
    } catch (err) {
      if (Date.now() >= deadline) {
        throw new Error(
          `run.json did not appear in ${runDir} within ${RUN_JSON_TIMEOUT_MS}ms: ${(err as Error).message}`,
        );
      }
      await sleep(POLL_MS);
    }
  }
}

/** Watches a live run: renders its transcript as the agent writes it, until it finishes. */
export async function watchRun(
  runDir: string,
  deps: { logger: Logger; write: (t: string) => void; style: Style },
): Promise<void> {
  const { logger, write, style } = deps;
  try {
    logger.info({ runDir }, "Watching run...");
    const info = await waitForRunInfo(runDir);
    if (info.status === "finished") {
      logger.info(
        { runDir },
        "Run already finished; replaying instead of following.",
      );
      await replayRun(runDir, { logger, write, style, delayMs: 0 });
      return;
    }
    const renderer = createRenderer(write, {
      style,
      maxTurns: info.maxTurns,
      maxWallTime: info.maxWallTime,
      startedAtMs: Date.parse(info.startedAt),
      now: Date.now,
    });
    const transcriptPath = join(runDir, "transcript.jsonl");
    const isFinished = async (): Promise<boolean> =>
      (await readRunInfo(runDir)).status === "finished";
    for await (const event of followTranscript(transcriptPath, isFinished)) {
      renderer.handle(event);
    }
    renderer.finish(await readRunInfo(runDir));
    logger.info({ runDir }, "Watching run succeeded.");
  } catch (err) {
    logger.error({ err, runDir }, "Watching run failed.");
    throw err;
  }
}
