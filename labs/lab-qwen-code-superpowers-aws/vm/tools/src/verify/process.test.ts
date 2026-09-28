import { describe, expect, it } from "vitest";
import { runStep } from "./process.js";

const CWD = process.cwd();

describe("runStep", () => {
  it("captures stdout and the exit code of a finished process", async () => {
    const result = await runStep(
      "node",
      ["-e", "console.log('hi'); process.exit(3)"],
      { cwd: CWD, timeoutMs: 5_000 },
    );
    expect(result).toEqual({
      code: 3,
      stdout: "hi\n",
      stderr: "",
      timedOut: false,
    });
  });

  it("kills a hanging process at the timeout and returns within 2s", async () => {
    const start = Date.now();
    const result = await runStep(
      "node",
      ["-e", "setTimeout(() => {}, 10000)"],
      { cwd: CWD, timeoutMs: 200 },
    );
    expect(result.timedOut).toBe(true);
    expect(Date.now() - start).toBeLessThan(2_000);
  }, 3_000);

  it("resolves (never throws) when the command does not exist", async () => {
    const result = await runStep("this-command-does-not-exist", [], {
      cwd: CWD,
      timeoutMs: 5_000,
    });
    expect(result.code).toBeNull();
    expect(result.timedOut).toBe(false);
    expect(result.stderr.length).toBeGreaterThan(0);
  });

  it("truncates stdout past 1 MB with a note", async () => {
    const result = await runStep(
      "node",
      ["-e", "process.stdout.write('a'.repeat(1024 * 1024 + 10))"],
      { cwd: CWD, timeoutMs: 5_000 },
    );
    expect(result.stdout.endsWith("[output truncated]")).toBe(true);
    expect(result.stdout.length).toBeLessThan(1024 * 1024 + 100);
  });
});
