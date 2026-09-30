import { describe, expect, it } from "vitest";
import { createLedger } from "./ledger.js";
import {
  a,
  b,
  draftFor,
  listing,
  read,
  requestFor,
} from "./report-test-utils.js";
import { renderReport, reportDraftSchema, validateDraft } from "./report.js";

describe("structured report validation", () => {
  it("keeps inherited article identifiers out of selection feedback", () => {
    const request = requestFor();
    const ledger = createLedger(request);
    read(ledger, a);
    const draft = draftFor();
    draft.articles = [{ sourceId: "toString", summary: "Invalid source" }];
    const feedback = validateDraft(draft, ledger.snapshot(), request);
    expect(feedback.invalidCitations).toEqual(["toString"]);
    expect(feedback.invalidSelections).toEqual([]);
  });
  it("keeps a redirected direct request distinct from articles selected from a listing", () => {
    const request = requestFor([listing, a]);
    const ledger = createLedger(request);
    read(ledger, listing);
    ledger.record({ kind: "attempt", operation: "read_page", url: a });
    const source = read(ledger, b);
    ledger.record({
      kind: "success",
      operation: "read_page",
      url: a,
      sourceId: source.id,
    });
    const draft = draftFor();
    draft.listingSourceIds = ["S1"];
    draft.articles = [{ sourceId: "S2", summary: "Direct article" }];
    draft.selectedUrls = [{ url: b, reason: "Direct request" }];
    expect(validateDraft(draft, ledger.snapshot(), request).status).toBe(
      "complete",
    );
  });
  it("requires listing provenance for a selected article reached from a listing", () => {
    const request = requestFor([listing]);
    const ledger = createLedger(request);
    read(ledger, listing);
    read(ledger, a);
    const draft = draftFor();
    draft.articles = [{ sourceId: "S2", summary: "Caching details." }];
    draft.listingSourceIds = ["S1"];
    expect(
      validateDraft(draft, ledger.snapshot(), request).invalidSelections,
    ).toEqual([a]);
  });

  it("handles inherited property names as invalid listing citations", () => {
    const request = requestFor();
    const ledger = createLedger(request);
    read(ledger, a);
    const draft = draftFor();
    draft.listingSourceIds = ["toString"];
    draft.selectedUrls = [
      { url: a, reason: "Caching", listingSourceId: "toString" },
    ];
    expect(() =>
      validateDraft(draft, ledger.snapshot(), request),
    ).not.toThrow();
    const feedback = validateDraft(draft, ledger.snapshot(), request);
    expect(feedback.invalidCitations).toEqual(["toString"]);
    expect(feedback.status).toBe("partial");
  });

  it("rejects invalid omission URLs rather than silently hiding them", () => {
    const request = requestFor();
    const ledger = createLedger(request);
    read(ledger, a);
    const draft = draftFor();
    draft.knownOmissions = [
      { url: "https://u:p@example.com/private", reason: "Outside topic" },
    ];
    expect(validateDraft(draft, ledger.snapshot(), request).status).toBe(
      "partial",
    );
  });
  it("renders a source link on each individually summarized article", () => {
    const request = requestFor([a, b]);
    const ledger = createLedger(request);
    read(ledger, a);
    read(ledger, b);
    const draft = draftFor();
    draft.articles.push({
      sourceId: "S2",
      summary: "Second article explains invalidation.",
    });
    draft.selectedUrls.push({ url: b, reason: "Explains invalidation" });
    const feedback = validateDraft(draft, ledger.snapshot(), request);
    expect(feedback.status).toBe("complete");
    expect(feedback.exitCode).toBe(0);
    expect(feedback.sourceUrls).toEqual({ S1: a, S2: b });
    const markdown = renderReport(draft, feedback);
    expect(markdown).toContain("[S1](https://example.com/a)");
    expect(markdown).toContain("[S2](https://example.com/b)");
  });

  it("links a broader theme to all its successfully read supporting pages", () => {
    const request = requestFor([a, b]);
    const ledger = createLedger(request);
    read(ledger, a);
    read(ledger, b, "crawl_site");
    const draft = draftFor();
    draft.themes = [
      {
        claim: "Both articles discuss cache lifetime.",
        sourceIds: ["S1", "S2"],
      },
    ];
    const feedback = validateDraft(draft, ledger.snapshot(), request);
    expect(renderReport(draft, feedback)).toContain(
      "Both articles discuss cache lifetime. [S1](https://example.com/a) [S2](https://example.com/b)",
    );
  });

  it("rejects a source without a successful page-read ledger event", () => {
    const request = requestFor();
    const ledger = createLedger(request);
    read(ledger, a);
    const snapshot = ledger.snapshot();
    snapshot.events = snapshot.events.filter(
      (event) => event.kind !== "success",
    );
    expect(
      validateDraft(draftFor(), snapshot, request).invalidCitations,
    ).toEqual(["S1"]);
  });

  it("marks an explicit all-articles request partial when a cap prevents exhaustion", () => {
    const request = requestFor([a], "Summarize all articles");
    const ledger = createLedger(request, { maxReads: 1 });
    read(ledger, a);
    ledger.takeRead("read_page", b);
    const feedback = validateDraft(draftFor(), ledger.snapshot(), request);
    expect(feedback.unmetExhaustiveScope).toBe(true);
    expect(feedback.status).toBe("partial");
    expect(feedback.repairPossible).toBe(false);
    expect(renderReport(draftFor(), feedback)).toContain("Partial");
  });

  it("rejects missing selection reasons through the runtime draft schema", () => {
    const draft = { ...draftFor(), selectedUrls: [{ url: a, reason: " " }] };
    expect(reportDraftSchema.safeParse(draft).success).toBe(false);
    const ledger = createLedger(requestFor());
    read(ledger, a);
    expect(validateDraft(draft, ledger.snapshot(), requestFor()).status).toBe(
      "partial",
    );
  });

  it("rejects malformed draft fields without rendering unchecked claims", () => {
    const draft = {
      ...draftFor(),
      themes: [{ claim: "UNCHECKED", sourceIds: [] }],
    };
    const ledger = createLedger(requestFor());
    read(ledger, a);
    const feedback = validateDraft(draft, ledger.snapshot(), requestFor());
    expect(feedback.schemaErrors.length).toBeGreaterThan(0);
    expect(renderReport(draft, feedback)).not.toContain("UNCHECKED");
  });

  it("rejects selected unread URLs and off-host listing selections", () => {
    const request = requestFor([listing]);
    const ledger = createLedger(request);
    read(ledger, listing);
    read(ledger, "https://other.example/a");
    const draft = draftFor();
    draft.articles = [{ sourceId: "S2", summary: "Other host" }];
    draft.listingSourceIds = ["S1"];
    draft.selectedUrls = [
      {
        url: "https://other.example/a",
        reason: "Other",
        listingSourceId: "S1",
      },
      { url: b, reason: "Unread" },
    ];
    const feedback = validateDraft(draft, ledger.snapshot(), request);
    expect(feedback.invalidSelections).toEqual(["https://other.example/a", b]);
    expect(feedback.selectedUrls).toEqual([]);
    expect(feedback.status).toBe("partial");
  });

  it("does not let draft Markdown create evidence links outside validated citations", () => {
    const request = requestFor();
    const ledger = createLedger(request);
    read(ledger, a);
    const draft = draftFor();
    draft.articles[0] = {
      sourceId: "S1",
      summary: "[Fake evidence](https://unread.example/)",
    };
    const markdown = renderReport(
      draft,
      validateDraft(draft, ledger.snapshot(), request),
    );
    expect(markdown).not.toContain("[Fake evidence](https://unread.example/)");
    expect(markdown).toContain("[S1](https://example.com/a)");
  });

  it("requires a selection reason for each summarized article", () => {
    const request = requestFor();
    const ledger = createLedger(request);
    read(ledger, a);
    const draft = draftFor();
    draft.selectedUrls = [];
    const feedback = validateDraft(draft, ledger.snapshot(), request);
    expect(feedback.invalidSelections).toEqual([a]);
    expect(feedback.status).toBe("partial");
  });
});
