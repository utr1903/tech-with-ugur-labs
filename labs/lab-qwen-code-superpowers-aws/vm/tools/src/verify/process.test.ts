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

  it("kills a grandchild too, not just the direct child, on timeout", async () => {
    // The direct child spawns a grandchild that inherits its stdio (as
    // `sh -c tsc`/`sh -c vitest` would), prints the grandchild's pid, then
    // hangs itself. If runStep only killed the direct child, `close` would
    // never fire because the grandchild still holds the stdio pipes open.
    const script = [
      "const { spawn } = require('node:child_process');",
      "const grandchild = spawn(process.execPath,",
      "  ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'inherit' });",
      "console.log(grandchild.pid);",
      "setInterval(() => {}, 1000);",
    ].join("\n");

    const start = Date.now();
    const result = await runStep("node", ["-e", script], {
      cwd: CWD,
      timeoutMs: 200,
    });

    let grandchildPid = 0;
    try {
      expect(result.timedOut).toBe(true);
      expect(Date.now() - start).toBeLessThan(3_000);

      grandchildPid = Number(result.stdout.trim());
      expect(Number.isInteger(grandchildPid)).toBe(true);
      expect(() => process.kill(grandchildPid, 0)).toThrow();
    } finally {
      // Clean up even if the assertions above failed, so a buggy runStep
      // doesn't leak a hanging process out of the test run.
      if (grandchildPid > 0) {
        try {
          process.kill(grandchildPid, "SIGKILL");
        } catch {
          // already gone, which is what this test is checking for
        }
      }
    }
  }, 5_000);
});
