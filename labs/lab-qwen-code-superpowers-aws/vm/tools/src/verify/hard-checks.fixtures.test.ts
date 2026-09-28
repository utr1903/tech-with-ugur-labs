import { describe, expect, it } from "vitest";
import { runHardChecks } from "./hard-checks.js";
import {
  acceptance,
  fakeSteps,
  ok,
  project,
  run,
} from "./hard-checks.test-support.js";

describe("runHardChecks acceptance and fixtures", () => {
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
