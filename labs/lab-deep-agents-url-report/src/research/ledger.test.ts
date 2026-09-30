import { describe, expect, it } from "vitest";
import { createLedger } from "./ledger.js";

const request = {
  instruction: "Read the article",
  requestedUrls: [
    {
      url: "https://example.com/a",
      host: "example.com",
      origins: [{ kind: "file" as const, line: 3 }],
    },
  ],
  invalidEntries: [],
};

describe("evidence ledger", () => {
  it("retains request origins and isolates snapshots from mutation", () => {
    const ledger = createLedger(request);
    const snapshot = ledger.snapshot();
    snapshot.request.requestedUrls[0]?.origins.push({ kind: "instruction" });
    expect(ledger.snapshot().request.requestedUrls[0]?.origins).toEqual([
      { kind: "file", line: 3 },
    ]);
  });
  it("denies the seventeenth read and twenty-fifth call without increasing counts", () => {
    const ledger = createLedger(request);
    for (let i = 0; i < 16; i++)
      expect(ledger.takeRead("read_page", "https://example.com/a")).toBe(true);
    expect(ledger.takeRead("read_page", "https://example.com/a")).toBe(false);
    for (let i = 0; i < 24; i++)
      expect(ledger.takeCall("search_web", "topic")).toBe(true);
    expect(ledger.takeCall("search_web", "topic")).toBe(false);
    expect(ledger.snapshot().counts).toEqual({ reads: 16, calls: 24 });
    expect(
      ledger
        .snapshot()
        .events.filter((event) => event.kind === "cap")
        .map((event) => event.reason),
    ).toEqual(["read-budget", "call-budget"]);
  });
  it("assigns stable source IDs, deduplicates normalized source URLs, and records plan events", () => {
    const ledger = createLedger(request);
    const source = {
      url: "https://example.com/a",
      title: "Article",
      text: "Evidence",
      truncated: false,
      operation: "read_page",
    };
    expect(ledger.addSource(source).id).toBe("S1");
    expect(ledger.addSource(source).id).toBe("S1");
    ledger.record({
      kind: "plan",
      operation: "planning",
      reason: "Expand listing",
    });
    expect(ledger.snapshot().sources).toHaveLength(1);
    expect(ledger.snapshot().events).toContainEqual({
      kind: "success",
      operation: "read_page",
      url: "https://example.com/a",
      sourceId: "S1",
    });
    expect(ledger.snapshot().events).toContainEqual({
      kind: "plan",
      operation: "planning",
      reason: "Expand listing",
    });
  });
  it("cannot raise hard caps or disable budgets through invalid overrides", () => {
    const ledger = createLedger(request, {
      maxReads: 99,
      maxCalls: Number.NaN,
      crawlDepth: Number.POSITIVE_INFINITY,
      crawlLimit: -1,
    });
    for (let i = 0; i < 16; i++)
      ledger.takeRead("read_page", "https://example.com/a");
    expect(ledger.takeRead("read_page", "https://example.com/a")).toBe(false);
    expect(ledger.limits).toMatchObject({
      maxReads: 16,
      maxCalls: 24,
      crawlDepth: 2,
      crawlLimit: 5,
    });
  });
});
