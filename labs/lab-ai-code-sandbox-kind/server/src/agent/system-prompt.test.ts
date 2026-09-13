import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "./system-prompt.js";

describe("buildSystemPrompt", () => {
  const prompt = buildSystemPrompt(new Date("2026-09-14T10:00:00Z"));

  it("pins today's date", () => {
    expect(prompt).toContain("Today's date is 2026-09-14.");
  });

  it("requires the tool, the method and the four sections in order", () => {
    expect(prompt).toContain("MUST call the code_executor tool");
    expect(prompt).toMatch(/numpy\.linalg\.solve/);
    expect(prompt).toMatch(/scipy\.optimize/);
    expect(prompt).toMatch(/sympy/);
    const order = [
      "### Model",
      "### Solver",
      "### Solution",
      "### Verification",
    ].map((h) => prompt.indexOf(h));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
});
