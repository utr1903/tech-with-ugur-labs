import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { RunInfo } from "../run/run-info.js";
import { runHardChecks } from "./hard-checks.js";
import type { RunStep, StepResult } from "./process.js";

const run = (exitCode: number): RunInfo => ({
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
});
const ok = (stdout = ""): StepResult => ({
  code: 0,
  stdout,
  stderr: "",
  timedOut: false,
});
const failed = (stderr: string): StepResult => ({
  code: 1,
  stdout: "",
  stderr,
  timedOut: false,
});

async function project(files: Record<string, string>) {
  const dir = await mkdtemp(join(tmpdir(), "work-"));
  for (const [name, content] of Object.entries(files)) {
    await mkdir(join(dir, name, ".."), { recursive: true });
    await writeFile(join(dir, name), content);
  }
  return dir;
}

async function acceptance() {
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

function fakeSteps(answers: (cmd: string, args: string[]) => StepResult) {
  const calls: string[] = [];
  const step: RunStep = async (cmd, args) => {
    calls.push([cmd, ...args].join(" "));
    return answers(cmd, args);
  };
  return { step, calls };
}

describe("runHardChecks", () => {
  it("passes a complete project", async () => {
    const workDir = await project({
      "package.json": "{}",
      "package-lock.json": "{}",
    });
    const { step } = fakeSteps((cmd, args) =>
      args.includes("summarize") ? ok('{"totalLines":1}') : ok(),
    );
    const results = await runHardChecks({
      run: run(0),
      workDir,
      acceptanceDir: await acceptance(),
      runStep: step,
    });
    expect(results.map((r) => [r.name, r.status])).toEqual([
      ["agent-exit", "pass"],
      ["install", "pass"],
      ["typecheck", "pass"],
      ["own-tests", "pass"],
      ["acceptance", "pass"],
      ["fixtures", "pass"],
    ]);
    expect(results.at(-1)?.detail).toBe("1/1 fixtures match");
  });

  it("fails agent-exit on a budget stop but still checks the code", async () => {
    const workDir = await project({
      "package.json": "{}",
      "package-lock.json": "{}",
    });
    const { step } = fakeSteps((_c, args) =>
      args.includes("summarize") ? ok('{"totalLines":1}') : ok(),
    );
    const results = await runHardChecks({
      run: run(55),
      workDir,
      acceptanceDir: await acceptance(),
      runStep: step,
    });
    expect(results[0]).toEqual({
      name: "agent-exit",
      status: "fail",
      detail: "Agent stopped by the wall-time or tool-call budget (exit 55)",
    });
    expect(results.slice(1).every((r) => r.status === "pass")).toBe(true);
  });

  it("fails install without a lockfile and skips everything that needs it", async () => {
    const workDir = await project({ "package.json": "{}" });
    const { step, calls } = fakeSteps(() => ok());
    const results = await runHardChecks({
      run: run(0),
      workDir,
      acceptanceDir: await acceptance(),
      runStep: step,
    });
    expect(results[1]).toEqual({
      name: "install",
      status: "fail",
      detail: "no package-lock.json in the workspace",
    });
    expect(results.slice(2).map((r) => r.status)).toEqual([
      "skipped",
      "skipped",
      "skipped",
      "skipped",
    ]);
    expect(calls).toEqual([]);
  });

  it("reports the tail of the output when a step fails", async () => {
    const workDir = await project({
      "package.json": "{}",
      "package-lock.json": "{}",
    });
    const { step } = fakeSteps((_c, args) =>
      args.includes("typecheck")
        ? failed("src/a.ts(1,1): error TS2322")
        : ok('{"totalLines":1}'),
    );
    const results = await runHardChecks({
      run: run(0),
      workDir,
      acceptanceDir: await acceptance(),
      runStep: step,
    });
    expect(results[2]).toMatchObject({ name: "typecheck", status: "fail" });
    expect(results[2]?.detail).toContain("error TS2322");
    expect(results[3]?.status).toBe("pass");
  });

  it("fails a fixture whose output is not JSON, and one that times out", async () => {
    const workDir = await project({
      "package.json": "{}",
      "package-lock.json": "{}",
    });
    const notJson = fakeSteps((_c, args) =>
      args.includes("summarize") ? ok("Summary: 1 line") : ok(),
    );
    const a = await runHardChecks({
      run: run(0),
      workDir,
      acceptanceDir: await acceptance(),
      runStep: notJson.step,
    });
    expect(a.at(-1)).toMatchObject({ name: "fixtures", status: "fail" });
    expect(a.at(-1)?.detail).toContain("main: output is not JSON");

    const hang = fakeSteps((_c, args) =>
      args.includes("summarize")
        ? { code: null, stdout: "", stderr: "", timedOut: true }
        : ok(),
    );
    const b = await runHardChecks({
      run: run(0),
      workDir,
      acceptanceDir: await acceptance(),
      runStep: hang.step,
    });
    expect(b.at(-1)?.detail).toContain("main: timed out");
  });

  it("names the differing fields of a wrong fixture output", async () => {
    const workDir = await project({
      "package.json": "{}",
      "package-lock.json": "{}",
    });
    const { step } = fakeSteps((_c, args) =>
      args.includes("summarize") ? ok('{"totalLines":2}') : ok(),
    );
    const results = await runHardChecks({
      run: run(0),
      workDir,
      acceptanceDir: await acceptance(),
      runStep: step,
    });
    expect(results.at(-1)?.detail).toContain("main: totalLines differs");
  });

  it("skips acceptance and fixtures for a task without an acceptance folder", async () => {
    const workDir = await project({
      "package.json": "{}",
      "package-lock.json": "{}",
    });
    const { step } = fakeSteps(() => ok());
    const results = await runHardChecks({
      run: run(0),
      workDir,
      acceptanceDir: null,
      runStep: step,
    });
    expect(results.slice(4)).toEqual([
      {
        name: "acceptance",
        status: "skipped",
        detail: "the task has no acceptance folder",
      },
      {
        name: "fixtures",
        status: "skipped",
        detail: "the task has no acceptance folder",
      },
    ]);
  });
});
