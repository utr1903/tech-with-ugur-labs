import { pino } from "pino";
import { describe, expect, it } from "vitest";
import { document, setup } from "./firecrawl-test-utils.js";
import { createResearchTools } from "./firecrawl-tools.js";
import { createLedger } from "./ledger.js";

describe("firecrawl-documents", () => {
  it("resolves document-relative listing links using the full referring URL", async () => {
    const { tools, firecrawl } = setup();
    firecrawl.page = document("https://example.com/news/article");
    expect(
      await tools.read_page({
        url: "article#part",
        referringUrl: "https://example.com/news/listing",
      }),
    ).toMatchObject({
      ok: true,
      source: { url: "https://example.com/news/article" },
    });
    expect(firecrawl.calls[0]?.input).toBe("https://example.com/news/article");
  });
  it("checks both requested and engine-reported URLs for redirects", async () => {
    const { tools, firecrawl } = setup();
    firecrawl.page.metadata = {
      sourceURL: "https://example.com/a",
      url: "https://other.example/a",
    };
    expect(
      await tools.read_page({ url: "https://example.com/a" }),
    ).toMatchObject({ ok: false, reason: "off-host" });
  });
  it("denies returned URLs whose DNS resolves privately", async () => {
    const { tools, firecrawl } = setup();
    let lookups = 0;
    const ledger = createLedger({
      instruction: "Read",
      requestedUrls: [],
      invalidEntries: [],
    });
    const guarded = createResearchTools({
      firecrawl,
      ledger,
      logger: pino({ level: "silent" }),
      clock: { now: () => 0, sleep: async () => {} },
      resolveDns: async (host: string) => {
        if (host === "example.com") lookups++;
        return lookups >= 2 ? ["10.1.1.1"] : ["93.184.216.34"];
      },
    });
    expect(
      await guarded.read_page({ url: "https://example.com/a" }),
    ).toMatchObject({ ok: false, reason: "dns-private" });
    expect(guarded.snapshot().sources).toEqual([]);
    expect(tools.snapshot().sources).toEqual([]);
  });
  it("truncates page text and records the character cap", async () => {
    const { tools, firecrawl } = setup({ maxPageCharacters: 4 });
    firecrawl.page = document("https://example.com/a", "123456");
    expect(
      await tools.read_page({ url: "https://example.com/a" }),
    ).toMatchObject({ ok: true, source: { text: "1234", truncated: true } });
    expect(
      tools
        .snapshot()
        .events.some((event) => event.reason === "page-characters"),
    ).toBe(true);
  });
  it("returns safe document-relative listing links and drops off-host links", async () => {
    const { tools, firecrawl } = setup();
    firecrawl.page = document("https://example.com/news/listing");
    firecrawl.page.links = [
      "article#top",
      "https://other.example/a",
      "http://localhost/a",
    ];
    expect(
      await tools.read_page({ url: "https://example.com/news/listing" }),
    ).toMatchObject({ ok: true, links: ["https://example.com/news/article"] });
  });
  it("rejects pages without returned source URL metadata", async () => {
    const { tools, firecrawl } = setup();
    firecrawl.page = {
      markdown: "Unattributed",
      metadata: { title: "Unknown" },
    };
    expect(
      await tools.read_page({ url: "https://example.com/a" }),
    ).toMatchObject({ ok: false, reason: "missing-source-url" });
  });
});
