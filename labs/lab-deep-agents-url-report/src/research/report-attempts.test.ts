import { describe, expect, it } from "vitest";
import { document, setup } from "./firecrawl-test-utils.js";
import { createLedger } from "./ledger.js";
import { a, draftFor, read, requestFor } from "./report-test-utils.js";
import { renderCoverage, validateDraft } from "./report.js";

describe("required direct read attempts", () => {
  it("keeps crawl-only supplied URLs missing while retaining their citation evidence", () => {
    const request = requestFor();
    const ledger = createLedger(request);
    read(ledger, a, "crawl_site");
    const feedback = validateDraft(draftFor(), ledger.snapshot(), request);
    expect(feedback.missingRequestedAttempts).toEqual([a]);
    expect(feedback.sourceUrls).toEqual({ S1: a });
    expect(feedback.status).toBe("partial");
    expect(feedback.exitCode).toBe(1);
    expect(renderCoverage(ledger.snapshot(), feedback).requestedUrls).toEqual([
      { url: a, origins: [{ kind: "instruction" }], outcome: "unattempted" },
    ]);
  });

  it("satisfies a supplied URL attempt when read_page reuses a crawled source", async () => {
    const { ledger, tools, firecrawl } = setup();
    firecrawl.jobs[0] = {
      id: "job-1",
      status: "completed",
      total: 1,
      completed: 1,
      data: [document(a)],
    };
    await tools.crawl_site({ url: a });
    const request = requestFor();
    expect(
      validateDraft(draftFor(), tools.snapshot(), request)
        .missingRequestedAttempts,
    ).toEqual([a]);
    expect(await tools.read_page({ url: a })).toMatchObject({
      ok: true,
      source: { id: "S1", operation: "crawl_site" },
    });
    const snapshot = ledger.snapshot();
    snapshot.request = request;
    const feedback = validateDraft(draftFor(), snapshot, request);
    expect(feedback.missingRequestedAttempts).toEqual([]);
    expect(feedback.status).toBe("complete");
    expect(snapshot.counts.reads).toBe(1);
    expect(renderCoverage(snapshot, feedback).requestedUrls).toEqual([
      { url: a, origins: [{ kind: "instruction" }], outcome: "read" },
    ]);
  });
});
