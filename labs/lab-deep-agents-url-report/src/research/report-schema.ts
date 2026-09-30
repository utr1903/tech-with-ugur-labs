import { z } from "zod";
import { validatePublicUrl } from "./scope.js";

const text = z.string().trim().min(1);
const publicUrl = text.refine(
  (url) => validatePublicUrl(url).valid,
  "Public HTTP(S) URL required",
);
export const reportDraftSchema = z.strictObject({
  articles: z.array(z.strictObject({ sourceId: text, summary: text })),
  themes: z.array(
    z.strictObject({ claim: text, sourceIds: z.array(text).min(1) }),
  ),
  selectedUrls: z.array(
    z.strictObject({
      url: publicUrl,
      reason: text,
      listingSourceId: text.optional(),
    }),
  ),
  listingSourceIds: z.array(text),
  knownOmissions: z.array(
    z.strictObject({ url: publicUrl.optional(), reason: text }),
  ),
  coverageNarrative: text,
});
export type ReportDraft = z.infer<typeof reportDraftSchema>;
export interface ValidationFeedback {
  status: "complete" | "partial";
  exitCode: 0 | 1;
  reasons: string[];
  schemaErrors: string[];
  missingRequestedAttempts: string[];
  failedRequestedUrls: string[];
  invalidCitations: string[];
  invalidSelections: string[];
  unmetExhaustiveScope: boolean;
  repairPossible: boolean;
  sourceUrls: Record<string, string>;
  articles: ReportDraft["articles"];
  themes: ReportDraft["themes"];
  selectedUrls: ReportDraft["selectedUrls"];
  listingSourceIds: string[];
  knownOmissions: ReportDraft["knownOmissions"];
  coverageNarrative: string;
}
