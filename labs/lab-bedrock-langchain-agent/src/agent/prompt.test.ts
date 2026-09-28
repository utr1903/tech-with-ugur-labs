import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "./prompt.js";

describe("buildSystemPrompt", () => {
  const prompt = buildSystemPrompt(new Date("2026-09-27T23:30:00.000Z"));

  it("pins today's date in UTC", () => {
    expect(prompt).toContain("Today's date is 2026-09-27.");
  });

  it("requires tool use and forbids guessing", () => {
    expect(prompt).toContain("MUST call at least one tool");
    expect(prompt).toContain("only from tool results");
  });

  it("names all three tools", () => {
    for (const name of ["query_customers", "query_products", "query_orders"]) {
      expect(prompt).toContain(name);
    }
  });
});
