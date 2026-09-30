import type { Document } from "@mendable/firecrawl-js";
import { ResearchDenied } from "./firecrawl-boundary.js";
import type { Documents } from "./firecrawl-documents.js";
import type { Ledger, Source } from "./ledger.js";

export function createCrawlPages(
  ledger: Ledger,
  documents: Documents,
  url: string,
  limit: number,
) {
  const sources = new Map<string, Source>();
  const seen = new Set<string>();
  const accept = async (page: Document): Promise<void> => {
    try {
      const result = await documents.accept(page, url, "crawl_site");
      sources.set(result.source.id, result.source);
    } catch (err) {
      if (!(err instanceof ResearchDenied) || err.reason.endsWith("budget"))
        throw err;
      ledger.record({
        kind: "denial",
        operation: "crawl_site",
        url,
        reason: err.reason,
      });
    }
  };
  const batch = async (pages: Document[]): Promise<void> => {
    for (const [index, page] of pages.entries()) {
      const key = `${index}:${page.metadata?.sourceURL}:${page.metadata?.url}`;
      if (seen.has(key)) continue;
      if (seen.size >= limit) {
        ledger.record({
          kind: "cap",
          operation: "crawl_site",
          url,
          reason: "crawl-pages",
        });
        break;
      }
      seen.add(key);
      if (!ledger.takeRead("crawl_site", url)) break;
      await accept(page);
    }
  };
  return {
    batch,
    full: () => seen.size >= limit,
    sources: () => [...sources.values()],
  };
}
