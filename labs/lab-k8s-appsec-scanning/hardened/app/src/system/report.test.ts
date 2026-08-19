import { describe, expect, it } from "vitest";
import { buildReport, MAX_REPORT_ROWS } from "./report.js";

describe("buildReport (hardened)", () => {
  it("caps rows at MAX_REPORT_ROWS", () => {
    expect(buildReport(MAX_REPORT_ROWS + 100).bytes).toBe(
      MAX_REPORT_ROWS * 8 * 1024 * 1024,
    );
  });
  it("rejects negative rows as zero", () => {
    expect(buildReport(-5)).toEqual({ bytes: 0 });
  });
});
