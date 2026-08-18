import { describe, expect, it } from "vitest";
import {
  buildAnalyzeSystemPrompt,
  buildResearchSystemPrompt,
} from "./prompts.js";

describe("prompts", () => {
  it("pins today's date in the research prompt", () => {
    const prompt = buildResearchSystemPrompt({ today: "2026-08-18" });
    expect(prompt).toContain("Today's date is 2026-08-18");
    expect(prompt).toContain("NOT your training data");
  });

  it("pins today's date in the analyze prompt", () => {
    const prompt = buildAnalyzeSystemPrompt({ today: "2026-08-18" });
    expect(prompt).toContain("Today's date is 2026-08-18");
  });

  it("requires the report to be written with the write_file tool", () => {
    const prompt = buildResearchSystemPrompt({ today: "2026-08-18" });
    expect(prompt).toContain("call write_file to create /report.md");
    expect(prompt).toContain("NEVER put the report text in your reply");
  });
});
