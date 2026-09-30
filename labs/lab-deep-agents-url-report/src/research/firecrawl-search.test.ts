import { describe, expect, it, vi } from "vitest";
import { setup } from "./firecrawl-test-utils.js";

describe("firecrawl-search", () => {
  it("returns validated deduplicated search candidates without treating snippets as evidence", async () => {
    const { tools, firecrawl } = setup();
    firecrawl.results = {
      web: [
        {
          url: "https://example.com/a#one",
          title: "Article",
          description: "Snippet",
          position: 1,
        },
        { url: "https://example.com/a#two", title: "Duplicate", position: 2 },
        { url: "http://127.0.0.1/a", title: "Private", position: 3 },
      ],
    };
    expect(await tools.search_web({ query: "article" })).toEqual({
      ok: true,
      candidates: [
        {
          url: "https://example.com/a",
          title: "Article",
          description: "Snippet",
        },
      ],
    });
    expect(tools.snapshot().sources).toEqual([]);
    expect(
      tools.snapshot().events.filter((event) => event.kind === "candidate"),
    ).toEqual([
      {
        kind: "candidate",
        operation: "search_web",
        url: "https://example.com/a",
      },
    ]);
    expect(firecrawl.calls[0]?.options).toMatchObject({
      sources: ["web"],
      limit: 5,
    });
  });
  it("returns a time cap when an empty search arrives after the deadline", async () => {
    const { tools, firecrawl, setTime } = setup();
    firecrawl.search = async () => {
      setTime(180_001);
      return { web: [] };
    };
    expect(await tools.search_web({ query: "article" })).toEqual({
      ok: false,
      recoverable: true,
      reason: "time-budget",
    });
    expect(tools.snapshot().events).toContainEqual({
      kind: "cap",
      operation: "search_web",
      url: "https://api.firecrawl.dev/",
      reason: "time-budget",
    });
  });
  it("propagates a candidate DNS timeout as a run cap", async () => {
    vi.useFakeTimers();
    try {
      const { tools, firecrawl, setResolver } = setup({ maxDurationMs: 50 });
      firecrawl.results = {
        web: [{ url: "https://example.com/a", title: "Article", position: 1 }],
      };
      setResolver(async (host) =>
        host === "example.com"
          ? new Promise<string[]>(() => {})
          : ["93.184.216.34"],
      );
      const result = tools.search_web({ query: "article" });
      await vi.advanceTimersByTimeAsync(51);
      expect(await result).toEqual({
        ok: false,
        recoverable: true,
        reason: "time-budget",
      });
      expect(
        tools
          .snapshot()
          .events.some(
            (event) => event.kind === "cap" && event.reason === "time-budget",
          ),
      ).toBe(true);
      expect(
        tools
          .snapshot()
          .events.some(
            (event) =>
              event.kind === "denial" && event.reason === "time-budget",
          ),
      ).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
