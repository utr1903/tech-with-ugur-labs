import pino from "pino";
import { describe, expect, it } from "vitest";
import { createInternetSearchTool, type SearchClient } from "./tavily-tool.js";

const logger = pino({ level: "silent" });

function fakeClient(
  results: Array<{ title: string; url: string; content: string }>,
): SearchClient {
  return {
    search: async () => ({ results }),
  };
}

describe("createInternetSearchTool", () => {
  it("is exposed to the agent as internet_search", () => {
    const searchTool = createInternetSearchTool({
      client: fakeClient([]),
      maxResults: 5,
      logger,
    });
    expect(searchTool.name).toBe("internet_search");
  });

  it("returns title, url and truncated content per result", async () => {
    const searchTool = createInternetSearchTool({
      client: fakeClient([
        { title: "T", url: "https://example.com", content: "x".repeat(3000) },
      ]),
      maxResults: 5,
      logger,
    });
    const raw = (await searchTool.invoke({ query: "anything" })) as string;
    const parsed = JSON.parse(raw) as Array<{
      title: string;
      url: string;
      content: string;
    }>;
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.url).toBe("https://example.com");
    expect(parsed[0]?.content.length).toBeLessThanOrEqual(1500);
  });
});
