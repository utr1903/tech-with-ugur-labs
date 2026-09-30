import type { LedgerSnapshot } from "./ledger.js";
import { successfullyReadUrls } from "./report-evidence.js";
import type { ReportDraft, ValidationFeedback } from "./report-schema.js";

export function blockingOmissions(
  draft: ReportDraft,
  ledger: LedgerSnapshot,
  sourceUrls: Record<string, string>,
): ValidationFeedback["blockingOmissions"] {
  const readUrls = successfullyReadUrls(ledger, sourceUrls);
  return draft.knownOmissions
    .filter((omission) => omission.impact === "blocking")
    .map((omission) => ({
      ...omission,
      outcome: outcome(omission.url, ledger, readUrls),
    }));
}

function outcome(
  url: string | undefined,
  ledger: LedgerSnapshot,
  readUrls: Set<string>,
): ValidationFeedback["blockingOmissions"][number]["outcome"] {
  if (url && readUrls.has(url)) return "read";
  const events = ledger.events.filter(
    (event) =>
      !url ||
      event.url === url ||
      (event.kind === "cap" &&
        ["read-budget", "call-budget", "time-budget"].includes(
          event.reason ?? "",
        )),
  );
  if (events.some((event) => event.kind === "cap")) return "capped";
  if (events.some((event) => event.kind === "failure")) return "failed";
  if (events.some((event) => event.kind === "denial")) return "denied";
  return "unread";
}
