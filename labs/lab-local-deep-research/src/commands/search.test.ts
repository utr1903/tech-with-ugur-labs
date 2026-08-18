import { describe, expect, it } from "vitest";
import { extractInlineReport } from "./search.js";

describe("extractInlineReport", () => {
  it("recovers a markdown report the model put in its reply", () => {
    const reply =
      "drafting the report now</think>\n\n# The Question\n\nAnswer paragraph.\n\n## Sources\n- https://example.com";
    expect(extractInlineReport(reply)).toBe(
      "# The Question\n\nAnswer paragraph.\n\n## Sources\n- https://example.com",
    );
  });

  it("returns undefined for the expected completion one-liner", () => {
    expect(extractInlineReport("report written to /report.md")).toBeUndefined();
  });

  it("returns undefined for an empty reply", () => {
    expect(extractInlineReport("")).toBeUndefined();
  });

  it("returns undefined when the reply is only leaked reasoning", () => {
    expect(
      extractInlineReport("<think>still deciding what to do</think>"),
    ).toBeUndefined();
  });
});
