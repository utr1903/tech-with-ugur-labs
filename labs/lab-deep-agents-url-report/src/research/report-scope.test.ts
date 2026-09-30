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
import { validateDraft } from "./report.js";

describe("exhaustive listing scope", () => {
  it.each([
    "Summarize each page separately, cite both",
    "Summarize each supplied page",
    "Summarize all supplied pages",
  ])(
    "keeps honest truncation separate from site exhaustion for %s",
    (instruction) => {
      const request = requestFor([a, b], instruction);
      const ledger = createLedger(request);
      read(ledger, a, "read_page", true);
      read(ledger, b);
      ledger.record({
        kind: "cap",
        operation: "read_page",
        url: a,
        reason: "page-characters",
      });
      const draft = draftFor();
      draft.articles.push({ sourceId: "S2", summary: "Second supplied page" });
      draft.selectedUrls.push({ url: b, reason: "Supplied page" });
      const feedback = validateDraft(draft, ledger.snapshot(), request);
      expect(feedback.unmetExhaustiveScope).toBe(false);
      expect(feedback.status).toBe("partial");
      expect(feedback.reasons).toEqual([
        "Some source content was truncated by the page limit.",
      ]);
    },
  );

  it.each([
    "Read each selected article",
    "Read every selected article",
    "Select up to three relevant linked articles. Read each selected article, cite each article individually, and disclose omissions.",
  ])("permits reasoned bounded selection for %s", (instruction) => {
    const request = requestFor([listing], instruction);
    const ledger = createLedger(request);
    read(ledger, listing);
    read(ledger, a);
    const draft = draftFor();
    draft.listingSourceIds = ["S1"];
    draft.articles = [{ sourceId: "S2", summary: "Relevant article" }];
    draft.selectedUrls = [
      { url: a, reason: "Matches the requested topic", listingSourceId: "S1" },
    ];
    draft.knownOmissions = [
      { url: b, reason: "Outside topic", impact: "nonblocking" },
    ];
    const feedback = validateDraft(draft, ledger.snapshot(), request);
    expect(feedback.unmetExhaustiveScope).toBe(false);
    expect(feedback.status).toBe("complete");
  });

  it.each([
    "Read all articles",
    "Read every article on this listing",
    "Read each page on this site",
  ])(
    "keeps an explicit listing request partial when capped: %s",
    (instruction) => {
      const request = requestFor([a], instruction);
      const ledger = createLedger(request, { maxReads: 1 });
      read(ledger, a);
      ledger.takeRead("read_page", b);
      const feedback = validateDraft(draftFor(), ledger.snapshot(), request);
      expect(feedback.unmetExhaustiveScope).toBe(true);
      expect(feedback.status).toBe("partial");
      expect(feedback.exitCode).toBe(1);
    },
  );
});
