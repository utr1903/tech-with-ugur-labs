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
  { length: 5 },
  (_, index) => `https://example.com/article-${index + 1}`,
);

it.each([
  {
    status: "scraping" as const,
    total: 9,
    expectedStatus: "partial",
    exitCode: 1,
  },
  {
    status: "completed" as const,
    total: 5,
    expectedStatus: "complete",
    exitCode: 0,
  },
])(
  "returns $expectedStatus for an exhaustive report after a $status five-page crawl",
  async ({ status, total, expectedStatus, exitCode }) => {
    const h = harness([listing], {}, "Read every article on this listing.");
    h.pages.set(listing, { ...document(listing), links: urls });
    h.firecrawl.jobs = [
      {
        id: "job-1",
        status,
        total,
        completed: 5,
        data: urls.map((url) => document(url)),
      },
    ];
    const reportDraft = draft({
      listingSourceIds: ["S1"],
      articles: [2, 3, 4, 5, 6].map((id) => ({
        sourceId: `S${id}`,
        summary: "Article evidence",
      })),
      selectedUrls: urls.map((url) => ({
        url,
        listingSourceId: "S1",
        reason: "Article on the supplied listing",
      })),
      knownOmissions: [],
    });
    const result = await runResearch(
      h.request,
      h.tools,
      new ScriptedModel([
        plan(),
        call("read_page", { url: listing }),
        call("crawl_site", { url: listing }),
        finish(reportDraft),
        plan(),
        finish(reportDraft),
        plan(),
        finish(reportDraft),
      ]),
      h.logger,
    );
    expect(result.coverage.status).toBe(expectedStatus);
    expect(result.exitCode).toBe(exitCode);
    expect(result.coverage.knownOmissions).toEqual([]);
    expect(result.coverage.failures).toEqual([]);
    expect(result.coverage.counts).toEqual({
      reads: 6,
      calls: status === "scraping" ? 4 : 3,
    });
    if (status === "scraping") {
      expect(result.coverage.limitsReached).toContainEqual({
        kind: "cap",
        operation: "crawl_site",
        url: listing,
        reason: "crawl-pages",
      });
      expect(result.coverage.reasons).toEqual([
        "The explicit exhaustive request remains unmet.",
      ]);
    } else {
      expect(result.coverage.limitsReached).toEqual([]);
      expect(result.coverage.reasons).toEqual([]);
    }
  },
);
