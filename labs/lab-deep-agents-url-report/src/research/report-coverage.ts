import type { ResearchRequest } from "./input.js";
import type { LedgerSnapshot, Source } from "./ledger.js";
import { requestedSourceIds, successfullyReadUrls } from "./report-evidence.js";
import { redactCoverage } from "./report-privacy.js";
import type { ReportDraft, ValidationFeedback } from "./report-schema.js";

type Outcome =
  | "read"
  | "failed"
  | "denied"
  | "capped"
  | "attempted"
  | "unattempted";
export interface CoverageRecord {
  status: ValidationFeedback["status"];
  exitCode: 0 | 1;
  reasons: string[];
  requestedUrls: {
    url: string;
    origins: ResearchRequest["requestedUrls"][number]["origins"];
    outcome: Outcome;
  }[];
  invalidEntries: Pick<
    ResearchRequest["invalidEntries"][number],
    "reason" | "origin"
  >[];
  listingPages: string[];
  crawlPages: string[];
  searchCandidates: string[];
  selectedUrls: ReportDraft["selectedUrls"];
  knownOmissions: ReportDraft["knownOmissions"];
  sources: {
    id: string;
    url: string;
    origin: "requested" | "site-discovered" | "search-discovered";
    truncated: boolean;
  }[];
  failures: {
    kind: string;
    operation: string;
    url?: string;
    reason?: string;
  }[];
  limitsReached: { operation: string; url?: string; reason?: string }[];
  planMilestones: { operation: string }[];
  limits: LedgerSnapshot["limits"];
  counts: LedgerSnapshot["counts"];
}

export function renderCoverage(
  ledger: LedgerSnapshot,
  feedback: ValidationFeedback,
): CoverageRecord {
  const searchCandidates = [
    ...new Set(
      ledger.events
        .filter(
          (event) =>
            event.kind === "candidate" && event.operation === "search_web",
        )
        .flatMap((event) => (event.url ? [event.url] : [])),
    ),
  ];
  const origin = (
    source: Source,
  ): CoverageRecord["sources"][number]["origin"] => {
    if (requestedSourceIds(ledger, feedback.sourceUrls).has(source.id))
      return "requested";
    return searchCandidates.includes(source.url)
      ? "search-discovered"
      : "site-discovered";
  };
  const eventMetadata = ({
    kind,
    operation,
    url,
    reason,
  }: LedgerSnapshot["events"][number]) => ({
    kind,
    operation,
    ...(url ? { url } : {}),
    ...(reason ? { reason } : {}),
  });
  return redactCoverage(
    {
      status: feedback.status,
      exitCode: feedback.exitCode,
      reasons: [...feedback.reasons],
      requestedUrls: ledger.request.requestedUrls.map(({ url, origins }) => ({
        url,
        origins: structuredClone(origins),
        outcome: requestedOutcome(url, ledger, feedback),
      })),
      invalidEntries: ledger.request.invalidEntries.map(
        ({ reason, origin }) => ({ reason, origin: structuredClone(origin) }),
      ),
      listingPages: feedback.listingSourceIds.flatMap((id) =>
        feedback.sourceUrls[id] ? [feedback.sourceUrls[id]] : [],
      ),
      crawlPages: ledger.sources
        .filter((source) => source.operation === "crawl_site")
        .map((source) => source.url),
      searchCandidates,
      selectedUrls: structuredClone(feedback.selectedUrls),
      knownOmissions: structuredClone(feedback.knownOmissions),
      sources: ledger.sources
        .filter((source) => feedback.sourceUrls[source.id] === source.url)
        .map((source) => ({
          id: source.id,
          url: source.url,
          origin: origin(source),
          truncated: source.truncated,
        })),
      failures: ledger.events
        .filter((event) => event.kind === "failure" || event.kind === "denial")
        .map(eventMetadata),
      limitsReached: ledger.events
        .filter((event) => event.kind === "cap")
        .map(eventMetadata),
      planMilestones: ledger.events
        .filter((event) => event.kind === "plan")
        .map(({ operation }) => ({ operation })),
      limits: { ...ledger.limits },
      counts: { ...ledger.counts },
    },
    ledger,
  );
}

function requestedOutcome(
  url: string,
  ledger: LedgerSnapshot,
  feedback: ValidationFeedback,
): Outcome {
  if (successfullyReadUrls(ledger, feedback.sourceUrls).has(url)) return "read";
  const events = ledger.events.filter(
    (event) => event.url === url && event.operation !== "search_web",
  );
  if (events.some((event) => event.kind === "cap")) return "capped";
  if (events.some((event) => event.kind === "denial")) return "denied";
  if (events.some((event) => event.kind === "failure")) return "failed";
  return events.some((event) => event.kind === "attempt")
    ? "attempted"
    : "unattempted";
}
