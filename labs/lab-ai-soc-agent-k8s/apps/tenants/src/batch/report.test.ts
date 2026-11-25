import { describe, expect, it } from "vitest";
import { summarizeRows } from "./report.js";

describe("summarizeRows", () => {
  it("counts rows and lists email domains without emails", () => {
    const summary = summarizeRows([
      { id: 1, name: "A", email: "a@example.test", card_last4: "0001" },
      { id: 2, name: "B", email: "b@example.test", card_last4: "0002" },
    ]);
    expect(summary).toEqual({ rowCount: 2, domains: ["example.test"] });
    expect(JSON.stringify(summary)).not.toContain("a@");
  });
});
