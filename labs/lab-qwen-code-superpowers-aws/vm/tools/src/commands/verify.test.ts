import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pino from "pino";
import { describe, expect, it } from "vitest";
import { createStyle } from "../render/style.js";
import type { RunStep } from "../verify/process.js";
import { verifyRun } from "./verify.js";

const logger = pino({ level: "silent" });
const style = createStyle(false);
const write = (): void => {};
const okStep: RunStep = async () => ({
  code: 0,
  stdout: "",
  stderr: "",
  timedOut: false,
});

const fixturePath = new URL(
  "../transcript/fixtures/tdd-session.jsonl",
  import.meta.url,
).pathname;

async function buildRun(status: "running" | "finished"): Promise<string> {
  const runDir = await mkdtemp(join(tmpdir(), "verify-run-"));
  await writeFile(
    join(runDir, "run.json"),
    JSON.stringify({
      runId: "r",
      task: "log-summary",
      status,
      startedAt: "2026-09-28T10:00:00Z",
      finishedAt: status === "finished" ? "2026-09-28T10:03:00Z" : null,
      exitCode: status === "finished" ? 0 : null,
      durationSeconds: status === "finished" ? 180 : null,
      maxTurns: 150,
      maxWallTime: "45m",
      model: "reference-solution",
    }),
  );
  await writeFile(
    join(runDir, "transcript.jsonl"),
    await readFile(fixturePath, "utf8"),
  );
  await mkdir(join(runDir, "workspace"), { recursive: true });
  await writeFile(join(runDir, "workspace/package.json"), "{}");
  await writeFile(join(runDir, "workspace/package-lock.json"), "{}");
  return runDir;
}

describe("verifyRun", () => {
  it("verifies a finished run with no acceptance folder as a pass", async () => {
    const runDir = await buildRun("finished");
    const scratchDir = await mkdtemp(join(tmpdir(), "verify-scratch-"));
    const outFile = join(scratchDir, "verdict.json");

    const verdict = await verifyRun(
      { runDir, acceptanceDir: null, outFile, scratchDir },
      { logger, write, style, runStep: okStep },
    );

    expect(verdict.verdict).toBe("pass");
    expect(verdict.measured.ranProgram).toBeNull();
    expect(
      verdict.hardChecks
        .filter((c) => c.status === "skipped")
        .map((c) => c.name),
    ).toEqual(["acceptance", "fixtures"]);

    const written = JSON.parse(await readFile(outFile, "utf8"));
    expect(written.verdict).toBe("pass");
    expect(written.hardChecks[4].status).toBe("skipped");
    expect(written.hardChecks[5].status).toBe("skipped");
    expect(written.measured.ranProgram).toBeNull();
  });

  it("rejects a run that is still in progress", async () => {
    const runDir = await buildRun("running");
    const scratchDir = await mkdtemp(join(tmpdir(), "verify-scratch-"));

    await expect(
      verifyRun(
        {
          runDir,
          acceptanceDir: null,
          outFile: join(scratchDir, "verdict.json"),
          scratchDir,
        },
        { logger, write, style, runStep: okStep },
      ),
    ).rejects.toThrow("run r is still in progress");
  });
});
