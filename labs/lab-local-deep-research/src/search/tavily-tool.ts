import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { DynamicStructuredTool } from "langchain";
import { z } from "zod";
import type { Logger } from "../logger.js";
import { toTopicSlug } from "./topic-slug.js";

// The model sees a trimmed snippet per result to protect the context window;
// the full untruncated results are archived to the notes directory instead.
const MODEL_CONTENT_CHARS = 1800;

export interface SearchResult {
  title: string;
  url: string;
  content: string;
}

export interface SearchClient {
  search(
    query: string,
    options: {
      maxResults: number;
      searchDepth: "advanced";
      includeAnswer: true;
    },
  ): Promise<{ results: SearchResult[]; answer?: string }>;
}

async function archiveResults({
  notesDir,
  sequence,
  query,
  answer,
  results,
}: {
  notesDir: string;
  sequence: number;
  query: string;
  answer: string | undefined;
  results: SearchResult[];
}): Promise<string> {
  const lines = [`# Search ${sequence}: ${query}`, ""];
  if (answer !== undefined && answer !== "") {
    lines.push(`> ${answer}`, "");
  }
  for (const result of results) {
    lines.push(`## ${result.title}`, "", result.url, "", result.content, "");
  }
  const notePath = path.join(notesDir, `${sequence}-${toTopicSlug(query)}.md`);
  await mkdir(notesDir, { recursive: true });
  await writeFile(notePath, lines.join("\n"), "utf8");
  return notePath;
}

export function createInternetSearchTool({
  client,
  maxResults,
  notesDir,
  logger,
}: {
  client: SearchClient;
  maxResults: number;
  notesDir: string;
  logger: Logger;
}) {
  let sequence = 0;
  return new DynamicStructuredTool({
    name: "internet_search",
    description:
      "Search the web for up-to-date information. Use it for facts you do not " +
      "already have: definitions, dates, numbers, people, announcements. Each " +
      "call archives its full results (with URLs) to /notes/ automatically — " +
      "do NOT save search notes yourself. Do NOT use it to read local files. " +
      "Returns JSON with a short synthesized answer and a list of results " +
      "(title, url, content snippet).",
    schema: z.object({
      query: z
        .string()
        .min(3)
        .describe(
          "A focused web search query targeting ONE aspect of the research " +
            "question — not the whole question repeated verbatim.",
        ),
    }),
    func: async ({ query }: { query: string }) => {
      try {
        logger.info({ query }, "Searching the web...");
        const response = await client.search(query, {
          maxResults,
          searchDepth: "advanced",
          includeAnswer: true,
        });
        sequence += 1;
        const notePath = await archiveResults({
          notesDir,
          sequence,
          query,
          answer: response.answer,
          results: response.results,
        });
        const results = response.results.map((result) => ({
          title: result.title,
          url: result.url,
          content: result.content.slice(0, MODEL_CONTENT_CHARS),
        }));
        logger.info(
          { query, count: results.length, notePath },
          "Searching the web succeeded.",
        );
        return JSON.stringify({ answer: response.answer, results });
      } catch (err) {
        // Returned as content instead of thrown: a transient search failure
        // should cost the agent one turn, not abort the whole research run.
        logger.error({ err, query }, "Searching the web failed.");
        const message = err instanceof Error ? err.message : String(err);
        return JSON.stringify({
          error: `Search failed: ${message}. Try ONE different query, or continue with what you already have.`,
        });
      }
    },
  });
}
