import { describe, expect, it } from "vitest";
import { renderGrid } from "./grid.js";

describe("renderGrid", () => {
  const text = renderGrid(
    [
      { questionId: "q1", model: "a", passed: true, reason: "" },
      { questionId: "q1", model: "b", passed: false, reason: "no tool call" },
      { questionId: "q2", model: "a", passed: true, reason: "" },
    ],
    ["q1", "q2"],
    ["a", "b"],
  );

  it("has one row per question and one column per model", () => {
    const lines = text.split("\n");
    expect(lines[0]).toMatch(/question\s+a\s+b/);
    expect(lines[2]).toMatch(/^q1\s+PASS\s+FAIL/);
  });

  it("shows a missing result as a failure", () => {
    expect(text.split("\n")[3]).toMatch(/^q2\s+PASS\s+FAIL/);
  });

  it("lists the reason for every failure and the total", () => {
    expect(text).toContain("q1 on b: no tool call");
    expect(text).toContain("q2 on b: not run");
    expect(text).toContain("2 of 4 passed");
  });
});
