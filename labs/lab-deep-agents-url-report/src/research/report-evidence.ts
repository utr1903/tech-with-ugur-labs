import type { ResearchRequest } from "./input.js";
import type { LedgerSnapshot } from "./ledger.js";
import type { ReportDraft } from "./report-schema.js";
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

function sourceIdsForUrls(
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

export function checkSelections(
  draft: ReportDraft,
  sourceUrls: Record<string, string>,
  independentUrls: string[],
) {
  const selectedUrls = draft.selectedUrls.filter(
    (selection) =>
      validSelection(selection, draft.listingSourceIds, sourceUrls) &&
      (Boolean(selection.listingSourceId) ||
        independentUrls.includes(selection.url)),
  );
  const missing = draft.articles.flatMap(({ sourceId }) => {
    const url = Object.hasOwn(sourceUrls, sourceId)
      ? sourceUrls[sourceId]
      : undefined;
    return url && !selectedUrls.some((selection) => selection.url === url)
      ? [url]
      : [];
  });
  const invalidSelections = [
    ...new Set([
      ...draft.selectedUrls
        .filter((selection) => !selectedUrls.includes(selection))
        .map((selection) => selection.url),
      ...missing,
    ]),
  ];
  return { selectedUrls, invalidSelections };
}

function validSelection(
  selection: ReportDraft["selectedUrls"][number],
  listingIds: string[],
  sourceUrls: Record<string, string>,
): boolean {
  const url = validatePublicUrl(selection.url);
  if (
    !url.valid ||
    url.url !== selection.url ||
    !Object.values(sourceUrls).includes(url.url)
  )
    return false;
  if (!selection.listingSourceId) return true;
  if (!Object.hasOwn(sourceUrls, selection.listingSourceId)) return false;
  const listing = sourceUrls[selection.listingSourceId];
  return Boolean(
    listing &&
      listingIds.includes(selection.listingSourceId) &&
      new URL(listing).host === new URL(url.url).host,
  );
}
