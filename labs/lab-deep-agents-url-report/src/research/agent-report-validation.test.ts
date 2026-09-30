import { expect, it } from "vitest";
import {
  ScriptedModel,
  call,
  draft,
  finish,
  harness,
  plan,
} from "./agent-test-utils.js";
import { runResearch } from "./agent.js";
import { document } from "./firecrawl-test-utils.js";

const listing = "https://example.com/news";
const urls = Array.from(
  { length: 6 },
  (_, index) => `https://example.com/article-${index + 1}`,
);
const selectedUrls = urls
  .slice(0, 3)
  .map((url) => ({ url, reason: "Relevant to the requested topic" }));
const listingDraft = () =>
  draft({
    listingSourceIds: ["S1"],
    articles: [2, 3, 4].map((id) => ({
      sourceId: `S${id}`,
      summary: "Relevant article evidence",
    })),
    selectedUrls,
    knownOmissions: urls.slice(3).map((url) => ({
      url,
      reason: "Outside the selected topic",
      impact: "nonblocking",
    })),
  });
function listingHarness() {
  const h = harness(
    [listing],
    {},
    "Select up to three relevant articles. Read each selected article and cite each article individually.",
  );
  h.pages.set(listing, { ...document(listing), links: urls });
  return h;
}
const listingReads = () => [
  plan(),
  call("read_page", { url: listing }),
  ...urls.map((url) => call("read_page", { url, referringUrl: listing })),
];

it("retains reasoned selections from a listing when the report omits listingSourceId", async () => {
  const h = listingHarness();
  const model = new ScriptedModel([...listingReads(), finish(listingDraft())]);
  const result = await runResearch(h.request, h.tools, model, h.logger);
  expect(result.exitCode, JSON.stringify(result.coverage)).toBe(0);
  expect(result.coverage.selectedUrls).toEqual(
    selectedUrls.map((selection) => ({ ...selection, listingSourceId: "S1" })),
  );
  expect(h.order).toHaveLength(7);
});

it("repairs omitted selections with concrete URL, listing ID, and reason instructions", async () => {
  const h = listingHarness();
  const model = new ScriptedModel([
    ...listingReads(),
    finish({ ...listingDraft(), selectedUrls: [] }),
    (messages) => {
      const feedback = String(messages.at(-1)?.content);
      for (const { url } of selectedUrls) {
        expect(feedback).toContain(
          JSON.stringify({
            url,
            listingSourceId: "S1",
            action: "add-selection-with-reason",
          }),
        );
      }
      expect(feedback).not.toContain(
        "The explicit exhaustive request remains unmet.",
      );
      return plan();
    },
    finish(listingDraft()),
  ]);
  const result = await runResearch(h.request, h.tools, model, h.logger);
  expect(result.exitCode, JSON.stringify(result.coverage)).toBe(0);
  expect(result.coverage.selectedUrls).toEqual(
    selectedUrls.map((selection) => ({ ...selection, listingSourceId: "S1" })),
  );
  expect(h.order).toHaveLength(7);
  expect(result.coverage.planMilestones).toHaveLength(2);
});

it("keeps direct each-page coverage partial only for the genuine source truncation", async () => {
  const directUrls = ["https://example.com/a", "https://other.org/b"];
  const h = harness(
    directUrls,
    { maxReads: 2, maxPageCharacters: 10 },
    "Read both supplied URLs and summarize each page.",
  );
  h.pages.set(
    directUrls[0] ?? "",
    document(directUrls[0] ?? "", "Long source content is truncated"),
  );
  h.pages.set(directUrls[1] ?? "", document(directUrls[1] ?? "", "Evidence"));
  const model = new ScriptedModel([
    plan(),
    ...directUrls.map((url) => call("read_page", { url })),
    finish(
      draft({
        articles: [
          { sourceId: "S1", summary: "A evidence" },
          { sourceId: "S2", summary: "B evidence" },
        ],
        selectedUrls: directUrls.map((url) => ({
          url,
          reason: "Supplied page",
        })),
      }),
    ),
  ]);
  const result = await runResearch(h.request, h.tools, model, h.logger);
  expect(result.exitCode).toBe(1);
  expect(result.coverage.reasons).toEqual([
    "Some source content was truncated by the page limit.",
  ]);
  expect(result.coverage.selectedUrls).toHaveLength(2);
  expect(result.report).toContain("[S1](https://example.com/a)");
  expect(result.report).toContain("[S2](https://other.org/b)");
});
