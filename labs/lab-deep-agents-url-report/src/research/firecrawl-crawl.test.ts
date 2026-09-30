import { describe, expect, it } from "vitest";
import { document, setup } from "./firecrawl-test-utils.js";

describe("firecrawl-crawl", () => {
  it("records the page cap when exactly five pages stop an unfinished crawl", async () => {
    const { tools, firecrawl } = setup();
    firecrawl.jobs = [
      {
        id: "job-1",
        status: "scraping",
        total: 9,
        completed: 5,
        data: Array.from({ length: 5 }, (_, index) =>
          document(`https://example.com/article-${index + 1}`),
        ),
      },
    ];
    const result = await tools.crawl_site({ url: "https://example.com/" });
    expect(result).toMatchObject({ ok: true, sources: expect.any(Array) });
    expect(tools.snapshot().sources).toHaveLength(5);
    expect(tools.snapshot().events).toContainEqual({
      kind: "cap",
      operation: "crawl_site",
      url: "https://example.com/",
      reason: "crawl-pages",
    });
    expect(firecrawl.calls.map((call) => call.operation)).toEqual([
      "startCrawl",
      "getCrawlStatus",
      "cancelCrawl",
    ]);
    expect(tools.snapshot().counts).toEqual({ reads: 5, calls: 3 });
  });
  it("enforces global reads across direct and crawl operations", async () => {
    const { tools, firecrawl } = setup({ maxReads: 2 });
    await tools.read_page({ url: "https://example.com/a" });
    firecrawl.jobs[0] = {
      id: "job-1",
      status: "completed",
      total: 3,
      completed: 3,
      data: [
        document("https://example.com/b"),
        document("https://example.com/c"),
        document("https://example.com/d"),
      ],
    };
    const result = await tools.crawl_site({
      url: "https://example.com/",
      limit: 99,
      depth: 99,
    });
    expect(result).toMatchObject({
      ok: true,
      sources: [{ id: "S2", url: "https://example.com/b" }],
    });
    expect(tools.snapshot().counts.reads).toBe(2);
    expect(
      await tools.read_page({ url: "https://example.com/e" }),
    ).toMatchObject({ ok: false, reason: "read-budget" });
    expect(firecrawl.calls[1]?.options).toMatchObject({
      limit: 1,
      maxDiscoveryDepth: 2,
      allowExternalLinks: false,
      allowSubdomains: false,
    });
  });
  it("caps crawls at five pages, validates returned hosts, and charges duplicate pages", async () => {
    const { tools, firecrawl } = setup();
    firecrawl.jobs[0] = {
      id: "job-1",
      status: "completed",
      total: 6,
      completed: 6,
      data: [
        document("https://example.com/a"),
        document("https://example.com/a"),
        document("https://other.example/a"),
        document("http://127.0.0.1/a"),
        document("https://example.com/b"),
        document("https://example.com/c"),
      ],
    };
    expect(
      await tools.crawl_site({ url: "https://example.com/" }),
    ).toMatchObject({ ok: true, sources: [{ id: "S1" }, { id: "S2" }] });
    expect(tools.snapshot().counts).toEqual({ reads: 5, calls: 2 });
    expect(firecrawl.calls[1]?.options).toEqual({ autoPaginate: false });
    expect(
      tools.snapshot().events.some((event) => event.reason === "crawl-pages"),
    ).toBe(true);
  });
  it("counts crawl start, polling and cancellation without exceeding the call cap", async () => {
    const { tools, firecrawl } = setup({ maxCalls: 3 });
    firecrawl.jobs = [
      { id: "job-1", status: "scraping", total: 5, completed: 0, data: [] },
    ];
    expect(
      await tools.crawl_site({ url: "https://example.com/" }),
    ).toMatchObject({ ok: true, sources: [] });
    expect(firecrawl.calls.map((call) => call.operation)).toEqual([
      "startCrawl",
      "getCrawlStatus",
      "cancelCrawl",
    ]);
    expect(tools.snapshot().counts.calls).toBe(3);
    expect(await tools.search_web({ query: "article" })).toMatchObject({
      ok: false,
      reason: "call-budget",
    });
    expect(firecrawl.calls).toHaveLength(3);
  });
  it("cancels an active crawl after a status provider error", async () => {
    const { tools, firecrawl } = setup();
    firecrawl.getCrawlStatus = async () => {
      throw new Error("Provider unavailable with secret");
    };
    await expect(
      tools.crawl_site({ url: "https://example.com/" }),
    ).rejects.toThrow("Firecrawl operation failed");
    expect(firecrawl.calls.map((call) => call.operation)).toEqual([
      "startCrawl",
      "cancelCrawl",
    ]);
    expect(tools.snapshot().counts.calls).toBe(3);
  });
});
