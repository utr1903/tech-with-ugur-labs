import type { Document } from "@mendable/firecrawl-js";
import { type Boundary, ResearchDenied } from "./firecrawl-boundary.js";
import type { Ledger, Source } from "./ledger.js";

export function createDocuments(ledger: Ledger, boundary: Boundary) {
  const returnedUrl = async (
    page: Document,
    reference: string,
  ): Promise<string> => {
    const reported = [page.metadata?.sourceURL, page.metadata?.url].filter(
      (url): url is string => typeof url === "string" && url.length > 0,
    );
    if (!reported.length) throw new ResearchDenied("missing-source-url");
    const validated = reported.map((url) => boundary.validate(url, reference));
    for (const url of validated) await boundary.publicDns(url.url);
    const actual = validated.at(-1);
    if (!actual) throw new ResearchDenied("missing-source-url");
    return actual.url;
  };
  const listingLinks = (
    page: Document,
    url: string,
    operation: string,
  ): string[] => {
    const links = new Set<string>();
    for (const raw of page.links ?? []) {
      try {
        links.add(boundary.validate(raw, url).url);
      } catch (err) {
        if (!(err instanceof ResearchDenied)) throw err;
        ledger.record({ kind: "denial", operation, reason: err.reason });
      }
    }
    return [...links];
  };
  const accept = async (
    page: Document,
    reference: string,
    operation: string,
  ): Promise<{ source: Source; links: string[] }> => {
    const url = await returnedUrl(page, reference);
    if ((page.metadata?.statusCode ?? 200) >= 400 || !page.markdown?.trim())
      throw new ResearchDenied("unreadable-page");
    const text = page.markdown.slice(0, ledger.limits.maxPageCharacters);
    const truncated = text.length < page.markdown.length;
    if (truncated)
      ledger.record({ kind: "cap", operation, url, reason: "page-characters" });
    const source = ledger.addSource({
      url,
      title: page.metadata?.title ?? "",
      text,
      truncated,
      operation,
    });
    return { source, links: listingLinks(page, url, operation) };
  };
  return { accept };
}
export type Documents = ReturnType<typeof createDocuments>;
