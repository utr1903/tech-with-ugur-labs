import { type Boundary, ResearchDenied } from "./firecrawl-boundary.js";
import { createCrawlPages } from "./firecrawl-crawl-pages.js";
import type { Documents } from "./firecrawl-documents.js";
import type { ResearchToolOptions } from "./firecrawl-types.js";
import type { Source } from "./ledger.js";

export function createCrawl(
  options: ResearchToolOptions,
  boundary: Boundary,
  documents: Documents,
) {
  const { ledger, firecrawl, clock } = options;
  const mustStop = (url: string): boolean => {
    const time = boundary.remaining() <= 1000;
    const calls = ledger.limits.maxCalls - ledger.snapshot().counts.calls <= 1;
    if (!time && !calls) return false;
    ledger.record({
      kind: "cap",
      operation: "crawl_site",
      url,
      reason: time ? "time-budget" : "call-budget",
    });
    return true;
  };
  const cancel = async (
    id: string,
    url: string,
    primaryFailed: boolean,
    done: boolean,
  ): Promise<void> => {
    if (done || boundary.remaining() <= 0) return;
    try {
      await boundary.call("crawl_cancel", url, () => firecrawl.cancelCrawl(id));
    } catch (err) {
      boundary.recordError("crawl_cancel", url, err);
      if (!primaryFailed) throw err;
    }
  };
  const poll = async (
    id: string,
    url: string,
    pages: ReturnType<typeof createCrawlPages>,
  ): Promise<boolean> => {
    const status = await boundary.call("crawl_status", url, () =>
      firecrawl.getCrawlStatus(id, { autoPaginate: false }),
    );
    await pages.batch(status.data);
    if (status.next)
      ledger.record({
        kind: "cap",
        operation: "crawl_site",
        url,
        reason: "crawl-pagination",
      });
    if (status.status === "failed") throw new Error("Crawl failed");
    if (status.status === "scraping" && pages.full())
      ledger.record({
        kind: "cap",
        operation: "crawl_site",
        url,
        reason: "crawl-pages",
      });
    return status.status !== "scraping";
  };
  return async (input: {
    url: string;
    limit?: number;
    depth?: number;
  }): Promise<{ sources: Source[] }> => {
    const url = boundary.validate(input.url).url;
    const available = ledger.limits.maxReads - ledger.snapshot().counts.reads;
    if (available <= 0) throw new ResearchDenied("read-budget");
    if (ledger.limits.maxCalls - ledger.snapshot().counts.calls < 3)
      throw new ResearchDenied("call-budget");
    const limit = Math.min(
      ledger.limits.crawlLimit,
      available,
      bounded(input.limit, ledger.limits.crawlLimit),
    );
    const depth = Math.min(
      ledger.limits.crawlDepth,
      bounded(input.depth, ledger.limits.crawlDepth),
    );
    const job = await boundary.call("crawl_start", url, () =>
      firecrawl.startCrawl(url, {
        limit,
        maxDiscoveryDepth: depth,
        allowExternalLinks: false,
        allowSubdomains: false,
        scrapeOptions: { formats: ["markdown", "links"] },
      }),
    );
    const pages = createCrawlPages(ledger, documents, url, limit);
    let done = false;
    let primaryFailed = false;
    try {
      while (!done && !mustStop(url)) {
        done = await poll(job.id, url, pages);
        if (done || pages.full()) break;
        await clock.sleep(Math.min(1000, boundary.remaining()));
      }
    } catch (err) {
      primaryFailed = true;
      throw err;
    } finally {
      await cancel(job.id, url, primaryFailed, done);
    }
    return { sources: pages.sources() };
  };
}
function bounded(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value)
    ? Math.max(1, Math.floor(value))
    : fallback;
}
