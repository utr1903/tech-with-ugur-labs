/**
 * Watching a run that has already finished by the time watching starts
 * must not render it as live: no elapsed clock in the turn lines, no
 * polling for more bytes that will never arrive.
 */
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pino from "pino";
import { describe, expect, it } from "vitest";
import { createStyle } from "../render/style.js";
import { watchRun } from "./watch.js";

const logger = pino({ level: "silent" });
const style = createStyle(false);

const fixturePath = new URL(
  "../transcript/fixtures/tdd-session.jsonl",
  import.meta.url,
).pathname;

async function buildFinishedRun(): Promise<string> {
  const runDir = await mkdtemp(join(tmpdir(), "watch-run-"));
  await writeFile(
    join(runDir, "run.json"),
    JSON.stringify({
      runId: "log-summary-20260928T100000Z",
      task: "log-summary",
      status: "finished",
      startedAt: "2026-09-28T10:00:00Z",
      finishedAt: "2026-09-28T10:03:03Z",
      exitCode: 0,
      durationSeconds: 183,
      maxTurns: 150,
      maxWallTime: "45m",
      model: "qwen3-coder-next",
    }),
  );
  await writeFile(
    join(runDir, "transcript.jsonl"),
    await readFile(fixturePath, "utf8"),
  );
  return runDir;
}

describe("watchRun", () => {
  it("replays instead of following when the run is already finished", async () => {
    const runDir = await buildFinishedRun();
    let out = "";
    const write = (t: string): void => {
      out += t;
    };

    await watchRun(runDir, { logger, write, style });

    // A live-watched turn line would show "now - startedAt" (e.g. every
    // turn "00:17"). Replaying a finished run shows plain turn numbers.
    expect(out).toContain("── turn 1/150 ──");
    expect(out).toContain("── turn 8/150 ──");
    expect(out).not.toMatch(/── turn \d+\/150 · \d{2}:\d{2}/);
    expect(out).toContain("✔ Finished: 8 turns, 7 tool calls, 3m03s");
    expect(out).toContain("Agent exited 0");
  });
});
