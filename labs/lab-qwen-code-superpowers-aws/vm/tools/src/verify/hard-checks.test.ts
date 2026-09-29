import { describe, expect, it } from "vitest";
import { runHardChecks } from "./hard-checks.js";
import {
  acceptance,
  failed,
  fakeSteps,
  ok,
  project,
  run,
} from "./hard-checks.test-support.js";

describe("runHardChecks", () => {
  it("passes a complete project", async () => {
    const workDir = await project({
      "package.json": "{}",
      "package-lock.json": "{}",
    });
    const { step } = fakeSteps((_cmd, args) =>
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
});
