/**
 * Replays a saved run from disk: reads the whole transcript at once
 * and renders it, optionally pacing output with a delay so a fast
 * session is still watchable. Missing run.json (e.g. a transcript
 * copied out on its own) is not an error: finish() simply prints no
 * exit-code line.
 */
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import type { Logger } from "../logger.js";
import { createRenderer } from "../render/renderer.js";
import type { Style } from "../render/style.js";
import { type RunInfo, readRunInfo } from "../run/run-info.js";
import { readTranscript } from "../transcript/reader.js";

async function readInfoOrNull(runDir: string): Promise<RunInfo | null> {
  try {
    return await readRunInfo(runDir);
  } catch {
    return null;
  }
}

const PACED_KINDS = new Set(["text-delta", "assistant", "tool-result"]);

/** Replays a saved run's transcript, optionally pacing it with `delayMs` between events. */
export async function replayRun(
  runDir: string,
  deps: {
    logger: Logger;
    write: (t: string) => void;
    style: Style;
    delayMs: number;
  },
): Promise<void> {
  const { logger, write, style, delayMs } = deps;
  try {
    logger.info({ runDir, delayMs }, "Replaying run...");
    const info = await readInfoOrNull(runDir);
    const renderer = createRenderer(write, {
      style,
      maxTurns: info?.maxTurns,
      maxWallTime: info?.maxWallTime,
    });
    const events = await readTranscript(join(runDir, "transcript.jsonl"));
    for (const event of events) {
      renderer.handle(event);
      if (delayMs > 0 && PACED_KINDS.has(event.kind)) await sleep(delayMs);
    }
    renderer.finish(info);
    logger.info({ runDir }, "Replaying run succeeded.");
  } catch (err) {
    logger.error({ err, runDir }, "Replaying run failed.");
    throw err;
  }
}
