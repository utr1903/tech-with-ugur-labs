import { tool } from "langchain";
import { z } from "zod";
import type { Logger } from "../logger.js";

const MAX_CONTENT_CHARS = 1500;

export interface SearchClient {
  search(
    query: string,
    options: { maxResults: number; searchDepth: "basic" },
  ): Promise<{
    results: Array<{ title: string; url: string; content: string }>;
  }>;
}

export function createInternetSearchTool({
  client,
  maxResults,
  logger,
}: {
  client: SearchClient;
  maxResults: number;
  logger: Logger;
}) {
  return tool(
    async ({ query }: { query: string }) => {
      try {
        logger.info({ query }, "Searching the web...");
        const response = await client.search(query, {
          maxResults,
          searchDepth: "basic",
        });
        const results = response.results.map((result) => ({
          title: result.title,
          url: result.url,
          content: result.content.slice(0, MAX_CONTENT_CHARS),
        }));
        logger.info(
          { query, count: results.length },
          "Searching the web succeeded.",
        );
        return JSON.stringify(results);
      } catch (err) {
        logger.error({ err, query }, "Searching the web failed.");
        throw err;
      }
    },
    {
      name: "internet_search",
      description:
        "Search the web for up-to-date information. Input: a focused search query. " +
        "Returns a JSON list of results with title, url and content snippet.",
      schema: z.object({
        query: z.string().describe("A focused web search query"),
      }),
    },
  );
}
