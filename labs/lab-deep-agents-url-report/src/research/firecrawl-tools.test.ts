import { describe, expect, it } from "vitest";
import { document, setup } from "./firecrawl-test-utils.js";
import { createFirecrawlClient } from "./firecrawl-tools.js";

describe("firecrawl-tools", () => {
  it("records the requested URL as a success alias after a validated same-host redirect", async () => {
    const { tools, firecrawl } = setup();
    firecrawl.page = document("https://example.com/b");
    expect(
      await tools.read_page({ url: "https://example.com/a" }),
    ).toMatchObject({
      ok: true,
      source: { id: "S1", url: "https://example.com/b" },
    });
    expect(tools.snapshot().events).toContainEqual({
      kind: "success",
      operation: "read_page",
      url: "https://example.com/a",
      sourceId: "S1",
    });
  });
  it("reads a direct page into stable evidence and deduplicates fragments", async () => {
    const { tools, firecrawl } = setup();
    expect(
      await tools.read_page({ url: "https://example.com/a#one" }),
    ).toMatchObject({
      ok: true,
      source: { id: "S1", url: "https://example.com/a", text: "Evidence" },
    });
    expect(
      await tools.read_page({ url: "https://example.com/a#two" }),
    ).toMatchObject({ ok: true, source: { id: "S1" } });
    expect(firecrawl.calls).toHaveLength(1);
    expect(tools.snapshot().counts).toEqual({ reads: 1, calls: 1 });
  });
  it("constructs the official SDK without sending a request", () => {
    const client = createFirecrawlClient("fc-placeholder");
    expect(typeof client.scrape).toBe("function");
    expect(typeof client.startCrawl).toBe("function");
  });
  it("deduplicates concurrent reads before they reach the provider", async () => {
    const { tools, firecrawl } = setup();
    const results = await Promise.all([
      tools.read_page({ url: "https://example.com/a#one" }),
      tools.read_page({ url: "https://example.com/a#two" }),
    ]);
    expect(results).toMatchObject([
      { ok: true, source: { id: "S1" } },
      { ok: true, source: { id: "S1" } },
    ]);
    expect(tools.snapshot().counts).toEqual({ reads: 1, calls: 1 });
    expect(firecrawl.calls).toHaveLength(1);
  });
  it("preserves discovered listing links when a duplicate read reuses evidence", async () => {
    const { tools, firecrawl } = setup();
    firecrawl.page = document("https://example.com/news/listing");
    firecrawl.page.links = ["article"];
    await tools.read_page({ url: "https://example.com/news/listing" });
    expect(
      await tools.read_page({ url: "https://example.com/news/listing#again" }),
    ).toMatchObject({ ok: true, links: ["https://example.com/news/article"] });
    expect(firecrawl.calls).toHaveLength(1);
  });
});
