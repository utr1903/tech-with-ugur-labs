import type { Document } from "@mendable/firecrawl-js";
import { describe, expect, it, vi } from "vitest";
import { document, setup } from "./firecrawl-test-utils.js";

describe("firecrawl-boundary", () => {
  it.each([
    ["http://127.0.0.1", undefined, "private-host"],
    ["https://other.example/a", "https://example.com/listing", "off-host"],
    ["https://u:p@example.com", undefined, "credentials"],
    ["file:///a", undefined, "protocol"],
  ])(
    "denies unsafe URL %s without a provider call",
    async (url, referringUrl, reason) => {
      const { tools, firecrawl } = setup();
      const input = referringUrl ? { url, referringUrl } : { url };
      expect(await tools.read_page(input)).toMatchObject({
        ok: false,
        recoverable: true,
        reason,
      });
      expect(firecrawl.calls).toHaveLength(0);
      expect(
        tools.snapshot().events.some((event) => event.kind === "denial"),
      ).toBe(true);
    },
  );
  it.each([["10.0.0.1"], ["93.184.216.34", "::1"], []])(
    "denies unsafe or absent DNS answers %j",
    async (...addresses) => {
      const { tools, firecrawl, setAnswers } = setup();
      setAnswers(addresses as string[]);
      expect(
        await tools.read_page({ url: "https://example.com/a" }),
      ).toMatchObject({ ok: false, reason: "dns-private" });
      expect(firecrawl.calls).toHaveLength(0);
    },
  );
  it("checks DNS again for each call and rejects a later private answer", async () => {
    const { tools, firecrawl, setAnswers } = setup();
    await tools.read_page({ url: "https://example.com/a" });
    setAnswers(["127.0.0.1"]);
    expect(await tools.search_web({ query: "article" })).toMatchObject({
      ok: false,
      reason: "dns-private",
    });
    expect(firecrawl.calls).toHaveLength(1);
  });
  it.each([
    ["http://localhost/a", "private-host"],
    ["https://other.example/a", "off-host"],
    ["https://u:p@example.com/a", "credentials"],
  ])("rejects returned source URL %s", async (url, reason) => {
    const { tools, firecrawl } = setup();
    firecrawl.page = document(url);
    expect(
      await tools.read_page({ url: "https://example.com/a" }),
    ).toMatchObject({ ok: false, recoverable: true, reason });
    expect(tools.snapshot().sources).toEqual([]);
  });
  it("denies new calls after the run deadline", async () => {
    const { tools, firecrawl, setTime } = setup();
    setTime(180_000);
    expect(
      await tools.read_page({ url: "https://example.com/a" }),
    ).toMatchObject({ ok: false, reason: "time-budget" });
    expect(firecrawl.calls).toHaveLength(0);
  });
  it("records authentication failure without returning or logging provider secrets", async () => {
    const { tools, firecrawl, logs } = setup();
    firecrawl.error = Object.assign(
      new Error("Authorization fc-secret-test-key"),
      { status: 401 },
    );
    await expect(
      tools.read_page({ url: "https://example.com/a" }),
    ).rejects.toThrow("Firecrawl authentication failed");
    expect(tools.snapshot().events).toContainEqual({
      kind: "failure",
      operation: "read_page",
      reason: "authentication",
      url: "https://example.com/a",
    });
    expect(JSON.stringify(tools.snapshot()) + logs.join("")).not.toContain(
      "fc-secret-test-key",
    );
  });
  it("rejects a provider response that arrives after the deadline", async () => {
    const { tools, firecrawl, setTime } = setup();
    firecrawl.scrape = async () => {
      setTime(180_001);
      return document("https://example.com/a");
    };
    expect(
      await tools.read_page({ url: "https://example.com/a" }),
    ).toMatchObject({ ok: false, reason: "time-budget" });
    expect(tools.snapshot().sources).toEqual([]);
  });
  it("bounds a stalled provider call by the remaining run time", async () => {
    vi.useFakeTimers();
    try {
      const { tools, firecrawl } = setup({ maxDurationMs: 50 });
      firecrawl.scrape = async () => new Promise<Document>(() => {});
      const result = tools.read_page({ url: "https://example.com/a" });
      await vi.advanceTimersByTimeAsync(51);
      expect(await result).toMatchObject({ ok: false, reason: "time-budget" });
    } finally {
      vi.useRealTimers();
    }
  });
  it("records a denied URL attempt even when the provider is never called", async () => {
    const { tools } = setup();
    await tools.read_page({ url: "http://localhost/a" });
    expect(tools.snapshot().events).toContainEqual({
      kind: "attempt",
      operation: "read_page",
      url: "http://localhost/a",
    });
  });
});
