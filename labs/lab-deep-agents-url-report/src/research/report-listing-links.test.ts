import { describe, expect, it } from "vitest";
import { document, setup } from "./firecrawl-test-utils.js";
import { a, b, draftFor, listing, requestFor } from "./report-test-utils.js";
import { renderCoverage, validateDraft } from "./report.js";

async function linkedArticle(actual = a) {
  const h = setup();
  h.firecrawl.page = {
    ...document(listing),
    links: [a, "https://other.example/offsite"],
  };
  await h.tools.read_page({ url: listing });
  h.firecrawl.page = document(actual);
  await h.tools.read_page({ url: a, referringUrl: listing });
  const request = requestFor(
    [listing],
    "Read each selected article and cite each article individually",
  );
  const snapshot = h.tools.snapshot();
  snapshot.request = request;
  const draft = draftFor();
  draft.listingSourceIds = ["S1"];
  draft.articles = [{ sourceId: "S2", summary: "Relevant article evidence" }];
  draft.selectedUrls = [
    { url: actual, reason: "Relevant to the requested topic" },
  ];
  return { ...h, request, snapshot, draft };
}

describe("validated listing link provenance", () => {
  it.each([a, `${a}/`])(
    "retains a justified linked selection without a model-supplied listing ID: %s",
    async (actual) => {
      const h = await linkedArticle(actual);
      const feedback = validateDraft(h.draft, h.snapshot, h.request);
      expect(feedback.selectedUrls).toEqual([
        {
          url: actual,
          reason: "Relevant to the requested topic",
          listingSourceId: "S1",
        },
      ]);
      expect(feedback.invalidSelections).toEqual([]);
      expect(feedback.status).toBe("complete");
      expect(renderCoverage(h.snapshot, feedback).selectedUrls).toEqual([
        {
          url: actual,
          reason: "Relevant to the requested topic",
          listingSourceId: "S1",
        },
      ]);
    },
  );

  it("gives concrete selection repair feedback when cited articles have no selection reasons", async () => {
    const h = await linkedArticle();
    h.draft.selectedUrls = [];
    const feedback = validateDraft(h.draft, h.snapshot, h.request);
    expect(feedback.selectedUrls).toEqual([]);
    expect(feedback.status).toBe("partial");
    expect(feedback.selectionRepairs).toEqual([
      { url: a, listingSourceId: "S1", action: "add-selection-with-reason" },
    ]);
  });

  it.each([" ", undefined])(
    "gives concrete reason repair feedback for a malformed selection instead of inventing a reason: %s",
    async (reason) => {
      const h = await linkedArticle();
      const raw = {
        ...h.draft,
        selectedUrls: [{ url: a, ...(reason === undefined ? {} : { reason }) }],
      };
      const feedback = validateDraft(raw, h.snapshot, h.request);
      expect(feedback.schemaErrors.length).toBeGreaterThan(0);
      expect(feedback.selectedUrls).toEqual([]);
      expect(feedback.selectionRepairs).toEqual([
        { url: a, listingSourceId: "S1", action: "add-selection-with-reason" },
      ]);
    },
  );

  it("rejects an actually read off-host source as a listing selection without search provenance", async () => {
    const h = await linkedArticle();
    const offsite = "https://other.example/offsite";
    h.firecrawl.page = document(offsite);
    await h.tools.read_page({ url: offsite });
    const snapshot = h.tools.snapshot();
    snapshot.request = h.request;
    h.draft.articles = [
      { sourceId: "S3", summary: "Read outside listing scope" },
    ];
    h.draft.selectedUrls = [
      { url: offsite, reason: "Claims listing relevance" },
    ];
    const feedback = validateDraft(h.draft, snapshot, h.request);
    expect(feedback.invalidCitations).toEqual([]);
    expect(feedback.invalidSelections).toEqual([offsite]);
    expect(feedback.selectedUrls).toEqual([]);
    expect(feedback.status).toBe("partial");
  });

  it("does not infer provenance for an arbitrary same-host read absent from listing links", async () => {
    const h = await linkedArticle();
    h.firecrawl.page = document(b);
    await h.tools.read_page({ url: b, referringUrl: listing });
    const snapshot = h.tools.snapshot();
    snapshot.request = h.request;
    h.draft.articles = [{ sourceId: "S3", summary: "Unlinked evidence" }];
    h.draft.selectedUrls = [{ url: b, reason: "Claims relevance" }];
    expect(
      validateDraft(h.draft, snapshot, h.request).invalidSelections,
    ).toEqual([b]);
  });

  it("does not turn an off-host link or an unread search candidate into article evidence", async () => {
    const h = await linkedArticle();
    h.ledger.record({
      kind: "candidate",
      operation: "search_web",
      url: "https://other.example/offsite",
    });
    const snapshot = h.tools.snapshot();
    snapshot.request = h.request;
    h.draft.articles = [{ sourceId: "unread", summary: "UNSUPPORTED" }];
    h.draft.selectedUrls = [
      {
        url: "https://other.example/offsite",
        reason: "Claims listing relevance",
      },
    ];
    const feedback = validateDraft(h.draft, snapshot, h.request);
    expect(
      snapshot.events
        .filter((event) => event.kind === "link")
        .map((event) => event.url),
    ).toEqual([a]);
    expect(feedback.invalidCitations).toEqual(["unread"]);
    expect(feedback.invalidSelections).toEqual([
      "https://other.example/offsite",
    ]);
    expect(feedback.selectedUrls).toEqual([]);
  });
});
