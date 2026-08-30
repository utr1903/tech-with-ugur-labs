import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "./prompts.js";

describe("buildSystemPrompt", () => {
  it("pins today's date and the plant ID rule", () => {
    const prompt = buildSystemPrompt({ todayIsoDate: "2026-08-28" });
    expect(prompt).toContain("2026-08-28");
    expect(prompt).toContain("numeric ID");
    expect(prompt).toMatch(/tool/i);
  });
});
