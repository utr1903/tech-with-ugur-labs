import { describe, expect, it } from "vitest";
import { failureDetail } from "./command-checks.js";
import type { StepResult } from "./process.js";

describe("failureDetail", () => {
  it("keeps only the last 15 non-empty lines of stderr+stdout combined", () => {
    const stderrLines = Array.from(
      { length: 10 },
      (_, i) => `stderr line ${i}`,
    );
    const stdoutLines = Array.from(
      { length: 10 },
      (_, i) => `stdout line ${i}`,
    );
    // Blank lines at the edges (and the join itself) must be dropped before
    // the last-15 slice is taken, not counted toward it.
    const result: StepResult = {
      code: 1,
      stdout: ["", ...stdoutLines, ""].join("\n"),
      stderr: ["", ...stderrLines, ""].join("\n"),
      timedOut: false,
    };

    const detail = failureDetail(result);
    const lines = detail.split("\n");

    expect(lines[0]).toBe("exit 1");
    expect(lines).toHaveLength(16);
    expect(lines.slice(1)).toEqual([...stderrLines.slice(5), ...stdoutLines]);
  });

  it("reports 'timed out' as the header for a timed-out step", () => {
    const result: StepResult = {
      code: null,
      stdout: "",
      stderr: "",
      timedOut: true,
    };
    expect(failureDetail(result)).toBe("timed out");
  });
});
