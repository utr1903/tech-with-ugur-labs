/**
 * Shared fixtures for the hard-checks tests: a minimal RunInfo, canned
 * step results, a scratch project directory and a fake acceptance
 * folder, plus a fake `runStep` that records every command it was
 * called with. Split out so both hard-checks.test.ts (the step checks)
 * and hard-checks.fixtures.test.ts (the acceptance/fixtures checks)
 * can build the same shape of project without duplicating it.
 */
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RunInfo } from "../run/run-info.js";
import type { RunStep, StepResult } from "./process.js";

export const run = (exitCode: number): RunInfo => ({
  runId: "r",
  task: "log-summary",
  status: "finished",
  startedAt: "2026-09-28T10:00:00Z",
  finishedAt: "2026-09-28T10:10:00Z",
  exitCode,
  durationSeconds: 600,
  maxTurns: 150,
  maxWallTime: "45m",
  model: "m",
  maxRounds: null,
});

export const ok = (stdout = ""): StepResult => ({
  code: 0,
  stdout,
  stderr: "",
  timedOut: false,
});

export const failed = (stderr: string): StepResult => ({
  code: 1,
  stdout: "",
  stderr,
  timedOut: false,
});

export async function project(files: Record<string, string>) {
  const dir = await mkdtemp(join(tmpdir(), "work-"));
  for (const [name, content] of Object.entries(files)) {
    await mkdir(join(dir, name, ".."), { recursive: true });
    await writeFile(join(dir, name), content);
  }
  return dir;
}

export async function acceptance() {
  return project({
    "verify.json": JSON.stringify({
      runCommand: ["npm", "run", "--silent", "summarize", "--"],
      programPattern: "summarize",
    }),
    "acceptance.test.ts": "",
    "fixtures/main.log": "x",
    "expected/main.json": JSON.stringify({ totalLines: 1 }),
  });
}

export function fakeSteps(
  answers: (cmd: string, args: string[]) => StepResult,
) {
  const calls: string[] = [];
  const step: RunStep = async (cmd, args) => {
    calls.push([cmd, ...args].join(" "));
    return answers(cmd, args);
  };
  return { step, calls };
}
