import type { ResearchRequest } from "./input.js";
import type { LedgerSnapshot } from "./ledger.js";
import {
  checkSelections,
  requestedSourceIds,
  successfulSources,
  successfullyReadUrls,
} from "./report-evidence.js";
import {
  type ReportDraft,
  type ValidationFeedback,
  reportDraftSchema,
} from "./report-schema.js";
import { validatePublicUrl } from "./scope.js";

export function validateDraft(
  draft: ReportDraft,
  ledger: LedgerSnapshot,
  request: ResearchRequest,
): ValidationFeedback {
  const sourceUrls = successfulSources(ledger);
  const parsed = reportDraftSchema.safeParse(draft);
  const data: ReportDraft = parsed.success
    ? parsed.data
    : {
        articles: [],
        themes: [],
        selectedUrls: [],
        listingSourceIds: [],
        knownOmissions: [],
        coverageNarrative: "The structured draft could not be validated.",
      };
  const schemaErrors = parsed.success
    ? []
    : parsed.error.issues.map(
        (issue) => `${issue.path.join(".")}: ${issue.code}`,
      );
  const validId = (id: string) => Object.hasOwn(sourceUrls, id);
  const invalidCitations = [
    ...new Set(
      [
        ...data.articles.map((article) => article.sourceId),
        ...data.themes.flatMap((theme) => theme.sourceIds),
        ...data.listingSourceIds,
        ...data.selectedUrls.flatMap((selection) =>
          selection.listingSourceId ? [selection.listingSourceId] : [],
        ),
      ].filter((id) => !validId(id)),
    ),
  ];
  const { selectedUrls, invalidSelections } = checkSelections(
    data,
    sourceUrls,
    [...requestedSourceIds(ledger, sourceUrls, request)].flatMap((id) =>
      sourceUrls[id] ? [sourceUrls[id]] : [],
    ),
  );
  const missingRequestedAttempts = request.requestedUrls
    .filter(
      ({ url }) =>
        !ledger.events.some(
          (event) =>
            event.kind === "attempt" &&
            event.operation !== "search_web" &&
            event.url === url,
        ),
    )
    .map(({ url }) => url);
  const readUrls = successfullyReadUrls(ledger, sourceUrls);
  const failedRequestedUrls = request.requestedUrls
    .filter(
      ({ url }) =>
        !missingRequestedAttempts.includes(url) && !readUrls.has(url),
    )
    .map(({ url }) => url);
  const unmetExhaustiveScope =
    /\b(?:all|every|each)\b(?:\s+[\w-]+){0,3}\s+(?:articles?|posts?|pages?|urls?|entries|links?)\b/i.test(
      request.instruction,
    ) &&
    (data.knownOmissions.length > 0 ||
      ledger.events.some((event) => event.kind === "cap"));
  const reasons = validationReasons(
    {
      schemaErrors,
      invalidCitations,
      invalidSelections,
      missingRequestedAttempts,
      failedRequestedUrls,
      unmetExhaustiveScope,
    },
    request,
    ledger,
    data,
  );
  const blocked =
    request.invalidEntries.length > 0 ||
    ledger.counts.reads >= ledger.limits.maxReads ||
    ledger.counts.calls >= ledger.limits.maxCalls ||
    ledger.events.some(
      (event) =>
        event.reason === "time-budget" || event.reason === "authentication",
    );
  return {
    status: reasons.length ? "partial" : "complete",
    exitCode: reasons.length ? 1 : 0,
    reasons,
    schemaErrors,
    sourceUrls,
    missingRequestedAttempts,
    failedRequestedUrls,
    invalidCitations,
    invalidSelections,
    unmetExhaustiveScope,
    repairPossible: reasons.length > 0 && !blocked,
    articles: data.articles.filter((article) => validId(article.sourceId)),
    themes: data.themes.filter((theme) => theme.sourceIds.every(validId)),
    selectedUrls,
    listingSourceIds: data.listingSourceIds.filter(validId),
    knownOmissions: data.knownOmissions.filter(
      (omission) => !omission.url || validatePublicUrl(omission.url).valid,
    ),
    coverageNarrative: data.coverageNarrative,
  };
}

function validationReasons(
  gaps: Pick<
    ValidationFeedback,
    | "schemaErrors"
    | "invalidCitations"
    | "invalidSelections"
    | "missingRequestedAttempts"
    | "failedRequestedUrls"
    | "unmetExhaustiveScope"
  >,
  request: ResearchRequest,
  ledger: LedgerSnapshot,
  draft: ReportDraft | undefined,
): string[] {
  const reasons: string[] = [];
  if (gaps.schemaErrors.length)
    reasons.push("The structured draft is invalid.");
  if (request.invalidEntries.length)
    reasons.push("Some supplied URLs are invalid.");
  if (gaps.missingRequestedAttempts.length)
    reasons.push("Some supplied URLs were not attempted.");
  if (gaps.failedRequestedUrls.length)
    reasons.push("Some supplied URLs were not successfully read.");
  if (gaps.invalidCitations.length)
    reasons.push("Some citations lack successful page reads.");
  if (gaps.invalidSelections.length)
    reasons.push(
      "Some selected articles are unread or outside their listing scope.",
    );
  if (gaps.unmetExhaustiveScope)
    reasons.push("The explicit exhaustive request remains unmet.");
  if (draft && draft.articles.length + draft.themes.length === 0)
    reasons.push("The draft contains no supported analysis.");
  if (ledger.sources.some((source) => source.truncated))
    reasons.push("Some source content was truncated by the page limit.");
  if (ledger.events.some((event) => event.reason === "time-budget"))
    reasons.push("The research time limit was reached.");
  return reasons;
}
