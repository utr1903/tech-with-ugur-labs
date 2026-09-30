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
import { renderCoverage, renderReport, validateDraft } from "./report.js";

describe("report coverage", () => {
  it("counts a successful same-host redirect as a requested read while citing its actual URL", () => {
    const request = requestFor();
    const ledger = createLedger(request);
    ledger.record({ kind: "attempt", operation: "read_page", url: a });
    const source = read(ledger, b);
    ledger.record({
      kind: "success",
      operation: "read_page",
      url: a,
      sourceId: source.id,
    });
    const draft = draftFor();
    draft.selectedUrls = [
      { url: b, reason: "Requested article after redirect" },
    ];
    const feedback = validateDraft(draft, ledger.snapshot(), request);
    expect(feedback.status).toBe("complete");
    expect(feedback.failedRequestedUrls).toEqual([]);
    expect(renderReport(draft, feedback)).toContain(
      "[S1](https://example.com/b)",
    );
    const coverage = renderCoverage(ledger.snapshot(), feedback);
    expect(coverage.requestedUrls).toEqual([
      { url: a, origins: [{ kind: "instruction" }], outcome: "read" },
    ]);
    expect(coverage.sources).toEqual([
      { id: "S1", url: b, origin: "requested", truncated: false },
    ]);
  });
  it("records listing selection reasons together with the validated listing source", () => {
    const request = requestFor([listing]);
    const ledger = createLedger(request);
    read(ledger, listing);
    read(ledger, a);
    const draft = draftFor();
    draft.articles[0] = { sourceId: "S2", summary: "Caching details." };
    draft.listingSourceIds = ["S1"];
    draft.selectedUrls = [
      { url: a, reason: "Relevant to cache lifetime", listingSourceId: "S1" },
    ];
    const feedback = validateDraft(draft, ledger.snapshot(), request);
    expect(feedback.status).toBe("complete");
    expect(renderCoverage(ledger.snapshot(), feedback).listingPages).toEqual([
      listing,
    ]);
    expect(renderCoverage(ledger.snapshot(), feedback).selectedUrls).toEqual([
      { url: a, reason: "Relevant to cache lifetime", listingSourceId: "S1" },
    ]);
    expect(renderReport(draft, feedback)).toContain(
      "Relevant to cache lifetime",
    );
  });

  it("marks a missing requested read attempt partial with actionable repair feedback", () => {
    const request = requestFor([a, b]);
    const ledger = createLedger(request);
    read(ledger, a);
    const feedback = validateDraft(draftFor(), ledger.snapshot(), request);
    expect(feedback.missingRequestedAttempts).toEqual([b]);
    expect(feedback.status).toBe("partial");
    expect(feedback.exitCode).toBe(1);
    expect(feedback.repairPossible).toBe(true);
    expect(
      renderCoverage(ledger.snapshot(), feedback).requestedUrls,
    ).toContainEqual({
      url: b,
      origins: [{ kind: "instruction" }],
      outcome: "unattempted",
    });
  });

  it("keeps failed requested attempts distinct from missing attempts", () => {
    const request = requestFor([a, b]);
    const ledger = createLedger(request);
    read(ledger, a);
    ledger.record({ kind: "attempt", operation: "read_page", url: b });
    ledger.record({
      kind: "failure",
      operation: "read_page",
      url: b,
      reason: "authentication",
    });
    const feedback = validateDraft(draftFor(), ledger.snapshot(), request);
    expect(feedback.missingRequestedAttempts).toEqual([]);
    expect(feedback.failedRequestedUrls).toEqual([b]);
    expect(feedback.status).toBe("partial");
    expect(
      renderCoverage(ledger.snapshot(), feedback).requestedUrls,
    ).toContainEqual({
      url: b,
      origins: [{ kind: "instruction" }],
      outcome: "failed",
    });
  });

  it("excludes search-only and unknown citations while retaining valid claims", () => {
    const request = requestFor();
    const ledger = createLedger(request);
    read(ledger, a);
    ledger.record({ kind: "candidate", operation: "search_web", url: b });
    const draft = draftFor();
    draft.articles.push({ sourceId: "S2", summary: "UNREAD ARTICLE CLAIM" });
    draft.themes.push({
      claim: "UNSUPPORTED THEME",
      sourceIds: ["S1", "https://example.com/b"],
    });
    const feedback = validateDraft(draft, ledger.snapshot(), request);
    expect(feedback.invalidCitations).toEqual(["S2", "https://example.com/b"]);
    expect(feedback.status).toBe("partial");
    const markdown = renderReport(draft, feedback);
    expect(markdown).toContain("First article explains caching.");
    expect(markdown).not.toContain("UNREAD ARTICLE CLAIM");
    expect(markdown).not.toContain("UNSUPPORTED THEME");
    expect(
      renderCoverage(ledger.snapshot(), feedback).searchCandidates,
    ).toEqual([b]);
  });

  it("accepts a relevant selection with disclosed unrelated omissions", () => {
    const request = requestFor();
    const ledger = createLedger(request);
    read(ledger, a);
    const draft = draftFor();
    draft.knownOmissions = [{ url: b, reason: "Unrelated topic" }];
    const feedback = validateDraft(draft, ledger.snapshot(), request);
    expect(feedback.status).toBe("complete");
    expect(renderReport(draft, feedback)).toContain("Unrelated topic");
    expect(renderCoverage(ledger.snapshot(), feedback).knownOmissions).toEqual([
      { url: b, reason: "Unrelated topic" },
    ]);
  });

  it("marks invalid input partial without copying credentialed raw input into coverage", () => {
    const request = requestFor();
    request.invalidEntries = [
      {
        valid: false,
        raw: "https://u:secret-key@example.com/",
        reason: "credentials",
        origin: { kind: "file", line: 2 },
      },
    ];
    const ledger = createLedger(request);
    read(ledger, a);
    const feedback = validateDraft(draftFor(), ledger.snapshot(), request);
    expect(feedback.status).toBe("partial");
    expect(feedback.repairPossible).toBe(false);
    expect(
      JSON.stringify(renderCoverage(ledger.snapshot(), feedback)),
    ).not.toContain("secret-key");
  });

  it("projects public coverage metadata without raw bodies, prompts, or plan reasoning", () => {
    const request = requestFor([a, b]);
    request.instruction = "PRIVATE PROMPT sk-request-fixture";
    const ledger = createLedger(request);
    read(ledger, a);
    read(ledger, b, "crawl_site");
    ledger.record({
      kind: "plan",
      operation: "planning",
      reason: "PRIVATE REASONING sk-plan-fixture",
    });
    ledger.record({
      kind: "denial",
      operation: "read_page",
      reason: "private-host",
    });
    const feedback = validateDraft(draftFor(), ledger.snapshot(), request);
    const coverage = renderCoverage(ledger.snapshot(), feedback);
    expect(coverage.crawlPages).toEqual([b]);
    expect(coverage.sources).toEqual([
      { id: "S1", url: a, origin: "requested", truncated: false },
      { id: "S2", url: b, origin: "requested", truncated: false },
    ]);
    expect(coverage.planMilestones).toEqual([{ operation: "planning" }]);
    const json = JSON.stringify(coverage);
    for (const secret of [
      "RAW PAGE BODY",
      "PRIVATE PROMPT",
      "PRIVATE REASONING",
      "sk-private-fixture",
      "sk-request-fixture",
      "sk-plan-fixture",
    ])
      expect(json).not.toContain(secret);
  });

  it("prevents draft selections and event metadata from echoing raw bodies or keys into coverage", () => {
    const request = requestFor();
    const ledger = createLedger(request);
    read(ledger, a);
    ledger.record({
      kind: "denial",
      operation: "read_page",
      url: "https://u:password-fixture@example.com/a?api_key=query-fixture",
      reason: "credentials",
    });
    const draft = draftFor();
    draft.selectedUrls[0] = {
      url: a,
      reason: "RAW PAGE BODY sk-private-fixture",
    };
    draft.knownOmissions = [{ reason: "sk-omission-fixture" }];
    const json = JSON.stringify(
      renderCoverage(
        ledger.snapshot(),
        validateDraft(draft, ledger.snapshot(), request),
      ),
    );
    for (const secret of [
      "RAW PAGE BODY",
      "sk-private-fixture",
      "password-fixture",
      "query-fixture",
      "sk-omission-fixture",
    ])
      expect(json).not.toContain(secret);
  });
});
