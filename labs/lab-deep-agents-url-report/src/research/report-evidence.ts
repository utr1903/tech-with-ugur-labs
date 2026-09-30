import type { ResearchRequest } from "./input.js";
import type { LedgerSnapshot } from "./ledger.js";
import { validatePublicUrl } from "./scope.js";

export function successfulSources(
  ledger: LedgerSnapshot,
): Record<string, string> {
  const entries = ledger.sources
    .filter(
      (source) =>
        ["read_page", "crawl_site"].includes(source.operation) &&
        validatePublicUrl(source.url).valid &&
        ledger.events.some(
          (event) =>
            event.kind === "success" &&
            event.sourceId === source.id &&
            event.url === source.url &&
            event.operation === source.operation,
        ),
    )
    .map((source) => [source.id, source.url]);
  return Object.fromEntries(entries);
}

export function successfullyReadUrls(
  ledger: LedgerSnapshot,
  sourceUrls: Record<string, string>,
): Set<string> {
  const urls = new Set(Object.values(sourceUrls));
  for (const event of ledger.events) {
    if (
      event.kind !== "success" ||
      event.operation !== "read_page" ||
      !event.url ||
      !event.sourceId
    )
      continue;
    if (!Object.hasOwn(sourceUrls, event.sourceId)) continue;
    const actual = sourceUrls[event.sourceId];
    const requested = validatePublicUrl(event.url);
    if (
      actual &&
      requested.valid &&
      new URL(actual).hostname === requested.host
    )
      urls.add(requested.url);
  }
  return urls;
}

export function requestedSourceIds(
  ledger: LedgerSnapshot,
  sourceUrls: Record<string, string>,
  request: ResearchRequest = ledger.request,
): Set<string> {
  const requestedUrls = new Set(request.requestedUrls.map(({ url }) => url));
  return sourceIdsForUrls(ledger, sourceUrls, requestedUrls);
}

export function searchCandidateUrls(ledger: LedgerSnapshot): string[] {
  return [
    ...new Set(
      ledger.events
        .filter(
          (event) =>
            event.kind === "candidate" && event.operation === "search_web",
        )
        .flatMap((event) =>
          event.url && validatePublicUrl(event.url).valid ? [event.url] : [],
        ),
    ),
  ];
}

export function searchSourceIds(
  ledger: LedgerSnapshot,
  sourceUrls: Record<string, string>,
): Set<string> {
  return sourceIdsForUrls(
    ledger,
    sourceUrls,
    new Set(searchCandidateUrls(ledger)),
  );
}

export function sourceIdsForUrls(
  ledger: LedgerSnapshot,
  sourceUrls: Record<string, string>,
  urls: Set<string>,
): Set<string> {
  const ids = Object.keys(sourceUrls).filter(
    (id) =>
      urls.has(sourceUrls[id] ?? "") ||
      ledger.events.some(
        (event) =>
          event.kind === "success" &&
          event.operation === "read_page" &&
          event.sourceId === id &&
          event.url &&
          urls.has(event.url) &&
          validAlias(event.url, sourceUrls[id]),
      ),
  );
  return new Set(ids);
}

function validAlias(alias: string, actual: string | undefined): boolean {
  const result = validatePublicUrl(alias);
  return Boolean(
    actual && result.valid && new URL(actual).hostname === result.host,
  );
}
