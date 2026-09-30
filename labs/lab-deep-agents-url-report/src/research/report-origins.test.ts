import { describe, expect, it } from "vitest";
import { createLedger } from "./ledger.js";
import { draftFor, listing, read, requestFor } from "./report-test-utils.js";
import { renderCoverage, validateDraft } from "./report.js";

const candidate = "https://other.example/context";
describe("selection origins", () => {
  it("retains search provenance through a validated same-host success alias", () => {
    const request = requestFor([listing], "Discover current context");
    const ledger = createLedger(request);
    read(ledger, listing);
    ledger.record({
      kind: "candidate",
      operation: "search_web",
      url: candidate,
    });
    ledger.record({ kind: "attempt", operation: "read_page", url: candidate });
    const actual = `${candidate}/`;
    const source = read(ledger, actual);
    ledger.record({
      kind: "success",
      operation: "read_page",
      url: candidate,
      sourceId: source.id,
    });
    const draft = draftFor();
    draft.listingSourceIds = ["S1"];
    draft.articles = [
      { sourceId: "S2", summary: "Current context after redirect" },
    ];
    draft.selectedUrls = [{ url: actual, reason: "Current context" }];
    const feedback = validateDraft(draft, ledger.snapshot(), request);
    const coverage = renderCoverage(ledger.snapshot(), feedback);
    expect(coverage.searchCandidates).toEqual([candidate]);
    expect(coverage.sources).toContainEqual({
      id: "S2",
      url: actual,
      origin: "search-discovered",
      truncated: false,
    });
    expect(feedback.status).toBe("complete");
    // Requested origin takes precedence if the same source also fulfills a supplied URL.
    const withDirectRequest = requestFor(
      [listing, actual],
      "Discover current context",
    );
    const snapshot = ledger.snapshot();
    snapshot.request = withDirectRequest;
    const directFeedback = validateDraft(draft, snapshot, withDirectRequest);
    expect(renderCoverage(snapshot, directFeedback).sources).toContainEqual({
      id: "S2",
      url: actual,
      origin: "requested",
      truncated: false,
    });
  });
  it("accepts a read external search candidate alongside a requested listing", () => {
    const request = requestFor(
      [listing],
      "Summarize relevant listing articles and discover current context",
    );
    const ledger = createLedger(request);
    read(ledger, listing);
    ledger.record({
      kind: "candidate",
      operation: "search_web",
      url: candidate,
    });
    read(ledger, candidate);
    const draft = draftFor();
    draft.listingSourceIds = ["S1"];
    draft.articles = [{ sourceId: "S2", summary: "Current context" }];
    draft.selectedUrls = [
      { url: candidate, reason: "Provides requested current context" },
    ];
    const feedback = validateDraft(draft, ledger.snapshot(), request);
    expect(feedback.status).toBe("complete");
    expect(feedback.selectedUrls).toEqual([
      { url: candidate, reason: "Provides requested current context" },
    ]);
    expect(renderCoverage(ledger.snapshot(), feedback).sources).toContainEqual({
      id: "S2",
      url: candidate,
      origin: "search-discovered",
      truncated: false,
    });
  });

  it("rejects an external selection without a ledger search candidate even without declared listings", () => {
    const request = requestFor([listing], "Find current context");
    const ledger = createLedger(request);
    read(ledger, listing);
    read(ledger, candidate);
    const draft = draftFor();
    draft.articles = [
      { sourceId: "S2", summary: "Unsupported discovery provenance" },
    ];
    draft.selectedUrls = [{ url: candidate, reason: "External context" }];
    expect(
      validateDraft(draft, ledger.snapshot(), request).invalidSelections,
    ).toEqual([candidate]);
  });
});
