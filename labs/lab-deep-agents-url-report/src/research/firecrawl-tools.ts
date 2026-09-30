import Firecrawl from "@mendable/firecrawl-js";
import { ResearchDenied, createBoundary } from "./firecrawl-boundary.js";
import { createCrawl } from "./firecrawl-crawl.js";
import { createDocuments } from "./firecrawl-documents.js";
import { createSearch } from "./firecrawl-search.js";
import type { ResearchToolOptions, ResearchTools } from "./firecrawl-types.js";

export function createFirecrawlClient(apiKey: string): Firecrawl {
  return new Firecrawl({
    apiKey,
    apiUrl: "https://api.firecrawl.dev",
    maxRetries: 0,
    timeoutMs: 30_000,
  });
}

export function createResearchTools(
  options: ResearchToolOptions,
): ResearchTools {
  const { firecrawl, ledger } = options;
  const boundary = createBoundary(options);
  const documents = createDocuments(ledger, boundary);
  const pages = new Map<string, Awaited<ReturnType<typeof documents.accept>>>();
  const crawl = createCrawl(options, boundary, documents);
  const search = createSearch(options, boundary);
  return {
    snapshot: () => ledger.snapshot(),
    read_page: (input) =>
      boundary.run("read_page", input.url, async () => {
        const url = boundary.validate(input.url, input.referringUrl).url;
        const cached = pages.get(url);
        if (cached) return structuredClone(cached);
        const existing = ledger.getSource(url);
        if (existing) return { source: existing, links: [] };
        if (!ledger.takeRead("read_page", url))
          throw new ResearchDenied("read-budget");
        const page = await boundary.call("read_page", url, () =>
          firecrawl.scrape(url, { formats: ["markdown", "links"] }),
        );
        const result = await documents.accept(page, url, "read_page");
        pages.set(url, structuredClone(result));
        pages.set(result.source.url, structuredClone(result));
        return result;
      }),
    search_web: ({ query }) =>
      boundary.run("search_web", "https://api.firecrawl.dev/", () =>
        search(query),
      ),
    crawl_site: (input) =>
      boundary.run("crawl_site", input.url, () => crawl(input)),
  };
}
