import type { SearchResultWeb } from "@mendable/firecrawl-js";
import { type Boundary, ResearchDenied } from "./firecrawl-boundary.js";
import type { Candidate, ResearchToolOptions } from "./firecrawl-types.js";

export function createSearch(options: ResearchToolOptions, boundary: Boundary) {
  const { ledger, firecrawl } = options;
  const candidate = async (
    input: SearchResultWeb,
  ): Promise<Candidate | undefined> => {
    try {
      const url = boundary.validate(input.url);
      await boundary.publicDns(url.url);
      return {
        url: url.url,
        title: input.title ?? "",
        description: input.description ?? "",
      };
    } catch (err) {
      if (!(err instanceof ResearchDenied)) throw err;
      ledger.record({
        kind: "denial",
        operation: "search_web",
        reason: err.reason,
      });
      return undefined;
    }
  };
  return async (query: string): Promise<{ candidates: Candidate[] }> => {
    if (!query.trim()) throw new ResearchDenied("empty-query");
    const response = await boundary.call(
      "search_web",
      "https://api.firecrawl.dev/",
      () => firecrawl.search(query, { sources: ["web"], limit: 5 }),
    );
    const candidates = new Map<string, Candidate>();
    for (const input of response.web ?? []) {
      if (!("url" in input) || typeof input.url !== "string") continue;
      const result = await candidate(input);
      if (result && !candidates.has(result.url))
        candidates.set(result.url, result);
    }
    return { candidates: [...candidates.values()] };
  };
}
