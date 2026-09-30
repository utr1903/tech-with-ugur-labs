import { describe, expect, it } from "vitest";
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
    expect(firecrawl.calls[0]?.options).toMatchObject({
      sources: ["web"],
      limit: 5,
    });
  });
});
