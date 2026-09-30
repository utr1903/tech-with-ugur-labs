import type { LedgerSnapshot } from "./ledger.js";
import { sourceIdsForUrls } from "./report-evidence.js";
import type { ReportDraft } from "./report-schema.js";
import { validatePublicUrl } from "./scope.js";

export function checkSelections(
  draft: ReportDraft,
  sourceUrls: Record<string, string>,
  independentUrls: string[],
  ledger: LedgerSnapshot,
) {
  const candidates = draft.selectedUrls.map((selection) => {
    if (selection.listingSourceId || independentUrls.includes(selection.url))
      return selection;
    const listingSourceId = listingForUrl(
      selection.url,
      draft.listingSourceIds,
      sourceUrls,
      ledger,
    );
    return listingSourceId ? { ...selection, listingSourceId } : selection;
  });
  const selectedUrls = candidates.filter(
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
      ...candidates
        .filter((selection) => !selectedUrls.includes(selection))
        .map((selection) => selection.url),
      ...missing,
    ]),
  ];
  return { selectedUrls, invalidSelections };
}

export function listingForUrl(
  url: string,
  listingIds: string[],
  sourceUrls: Record<string, string>,
  ledger: LedgerSnapshot,
): string | undefined {
  const articleId = Object.keys(sourceUrls).find(
    (id) => sourceUrls[id] === url,
  );
  if (!articleId) return undefined;
  return listingIds.find((listingId) => {
    const listing = Object.hasOwn(sourceUrls, listingId)
      ? sourceUrls[listingId]
      : undefined;
    if (!listing || new URL(listing).hostname !== new URL(url).hostname)
      return false;
    const links = ledger.events
      .filter(
        (event) =>
          event.kind === "link" &&
          event.sourceId === listingId &&
          ["read_page", "crawl_site"].includes(event.operation),
      )
      .flatMap((event) => {
        const parsed = event.url ? validatePublicUrl(event.url) : undefined;
        return parsed?.valid && parsed.host === new URL(listing).hostname
          ? [parsed.url]
          : [];
      });
    return sourceIdsForUrls(ledger, sourceUrls, new Set(links)).has(articleId);
  });
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
