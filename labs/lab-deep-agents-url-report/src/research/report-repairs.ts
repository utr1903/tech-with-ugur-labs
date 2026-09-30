import { z } from "zod";
import type { LedgerSnapshot } from "./ledger.js";
import type { ValidationFeedback } from "./report-schema.js";
import { listingForUrl } from "./report-selections.js";

const hints = z.object({
  articles: z.array(z.object({ sourceId: z.string() })).default([]),
  listingSourceIds: z.array(z.string()).default([]),
  selectedUrls: z
    .array(z.object({ url: z.string(), reason: z.unknown().optional() }))
    .default([]),
});

export function selectionRepairs(
  raw: unknown,
  ledger: LedgerSnapshot,
  sourceUrls: Record<string, string>,
): ValidationFeedback["selectionRepairs"] {
  const parsed = hints.safeParse(raw);
  if (!parsed.success) return [];
  const data = parsed.data;
  const urls = [
    ...new Set(
      data.articles.flatMap(({ sourceId }) =>
        Object.hasOwn(sourceUrls, sourceId) && sourceUrls[sourceId]
          ? [sourceUrls[sourceId]]
          : [],
      ),
    ),
  ];
  return urls
    .filter(
      (url) =>
        !data.selectedUrls.some(
          (selection) =>
            selection.url === url &&
            typeof selection.reason === "string" &&
            selection.reason.trim(),
        ),
    )
    .map((url) => {
      const listingSourceId = listingForUrl(
        url,
        data.listingSourceIds,
        sourceUrls,
        ledger,
      );
      return {
        url,
        ...(listingSourceId ? { listingSourceId } : {}),
        action: "add-selection-with-reason",
      };
    });
}
