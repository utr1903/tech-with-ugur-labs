import type { ResearchRequest } from "./input.js";
import type { createLedger } from "./ledger.js";
import type { ReportDraft } from "./report.js";

export const a = "https://example.com/a";
export const b = "https://example.com/b";
export const listing = "https://example.com/articles";
export const requestFor = (
  urls = [a],
  instruction = "Summarize relevant articles",
): ResearchRequest => ({
  instruction,
  requestedUrls: urls.map((url) => ({
    url,
    host: "example.com",
    origins: [{ kind: "instruction" }],
  })),
  invalidEntries: [],
});
export const draftFor = (): ReportDraft => ({
  articles: [{ sourceId: "S1", summary: "First article explains caching." }],
  themes: [],
  selectedUrls: [{ url: a, reason: "Explains caching" }],
  listingSourceIds: [],
  knownOmissions: [],
  coverageNarrative: "Read the requested article.",
});
export function read(
  ledger: ReturnType<typeof createLedger>,
  url: string,
  operation = "read_page",
  truncated = false,
) {
  ledger.record({ kind: "attempt", operation, url });
  ledger.takeRead(operation, url);
  return ledger.addSource({
    url,
    operation,
    title: "Title",
    text: "RAW PAGE BODY sk-private-fixture",
    truncated,
  });
}
