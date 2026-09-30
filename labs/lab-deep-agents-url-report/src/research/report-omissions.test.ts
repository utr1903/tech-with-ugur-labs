import { describe, expect, it } from "vitest";
import { createLedger } from "./ledger.js";
import { a, b, draftFor, read, requestFor } from "./report-test-utils.js";
import { renderCoverage, reportDraftSchema, validateDraft } from "./report.js";

describe("omission impact", () => {
  it.each([
    { kind: "cap" as const, reason: "read-budget", outcome: "capped" },
    { kind: "failure" as const, reason: "provider-error", outcome: "failed" },
    { kind: "denial" as const, reason: "dns-private", outcome: "denied" },
  ])(
    "marks a relevant blocking omission partial after $kind",
    ({ kind, reason, outcome }) => {
      const request = requestFor();
      const ledger = createLedger(request, { maxReads: 1 });
      read(ledger, a);
      if (kind === "cap") ledger.takeRead("read_page", b);
      else ledger.record({ kind, operation: "read_page", url: b, reason });
      const draft = draftFor();
      draft.knownOmissions = [
        {
          url: b,
          reason: "Needed article could not be read",
          impact: "blocking",
        },
      ];
      const feedback = validateDraft(draft, ledger.snapshot(), request);
      expect(feedback.schemaErrors).toEqual([]);
      expect(feedback.status).toBe("partial");
      expect(feedback.exitCode).toBe(1);
      expect(feedback.blockingOmissions).toEqual([
        {
          url: b,
          reason: "Needed article could not be read",
          impact: "blocking",
          outcome,
        },
      ]);
      expect(
        renderCoverage(ledger.snapshot(), feedback).blockingOmissions,
      ).toEqual([
        {
          url: b,
          reason: "Needed article could not be read",
          impact: "blocking",
          outcome,
        },
      ]);
    },
  );

  it.each([
    { kind: "cap" as const, reason: "read-budget" },
    { kind: "failure" as const, reason: "provider-error" },
  ])(
    "allows an explicitly nonblocking unrelated omission despite an incidental $kind",
    ({ kind, reason }) => {
      const request = requestFor();
      const ledger = createLedger(request, { maxReads: 1 });
      read(ledger, a);
      if (kind === "cap") ledger.takeRead("read_page", b);
      else ledger.record({ kind, operation: "read_page", url: b, reason });
      const draft = draftFor();
      draft.knownOmissions = [
        { url: b, reason: "Unrelated topic", impact: "nonblocking" },
      ];
      const feedback = validateDraft(draft, ledger.snapshot(), request);
      expect(feedback.status).toBe("complete");
      expect(feedback.exitCode).toBe(0);
      expect(feedback.blockingOmissions).toEqual([]);
      expect(
        renderCoverage(ledger.snapshot(), feedback).knownOmissions,
      ).toEqual([{ url: b, reason: "Unrelated topic", impact: "nonblocking" }]);
    },
  );

  it("requires omission impact rather than deriving it from prose", () => {
    const draft = {
      ...draftFor(),
      knownOmissions: [{ url: b, reason: "Irrelevant article" }],
    };
    expect(reportDraftSchema.safeParse(draft).success).toBe(false);
  });

  it("keeps an explicitly blocking omission partial even before its read attempt", () => {
    const request = requestFor();
    const ledger = createLedger(request);
    read(ledger, a);
    const draft = draftFor();
    draft.knownOmissions = [
      { url: b, reason: "Missing required evidence", impact: "blocking" },
    ];
    const feedback = validateDraft(draft, ledger.snapshot(), request);
    expect(feedback.schemaErrors).toEqual([]);
    expect(feedback.status).toBe("partial");
    expect(feedback.repairPossible).toBe(true);
    expect(feedback.blockingOmissions[0]?.outcome).toBe("unread");
  });
});
