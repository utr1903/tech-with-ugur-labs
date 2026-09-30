import type { ResearchRequest } from "./input.js";
import type { LedgerSnapshot } from "./ledger.js";
import {
  type ReportDraft,
  type ValidationFeedback,
  renderCoverage,
  renderReport,
  reportDraftSchema,
  validateDraft,
} from "./report.js";

export function emptyDraft(reason: string): ReportDraft {
  return {
    articles: [],
    themes: [],
    selectedUrls: [],
    listingSourceIds: [],
    knownOmissions: [{ reason, impact: "blocking" }],
    coverageNarrative: reason,
  };
}
export function researchResult(
  draft: ReportDraft,
  snapshot: LedgerSnapshot,
  feedback: ValidationFeedback,
) {
  return {
    report: renderReport(draft, feedback),
    coverage: renderCoverage(snapshot, feedback),
    exitCode: feedback.exitCode,
  };
}
export function failedResult(
  request: ResearchRequest,
  snapshot: LedgerSnapshot,
  reason: string,
) {
  const draft = emptyDraft(reason);
  return researchResult(
    draft,
    snapshot,
    validateDraft(draft, snapshot, request),
  );
}

export function evaluateDraft(
  candidate: unknown,
  snapshot: LedgerSnapshot,
  request: ResearchRequest,
  hasPlan: boolean,
) {
  const parsed = reportDraftSchema.safeParse(candidate);
  const draft = parsed.success
    ? parsed.data
    : emptyDraft("The structured draft could not be validated.");
  if (!hasPlan)
    draft.knownOmissions.push({
      reason: "A required research plan was not recorded.",
      impact: "blocking",
    });
  return {
    draft,
    feedback: validateDraft(
      parsed.success ? draft : candidate,
      snapshot,
      request,
    ),
  };
}
