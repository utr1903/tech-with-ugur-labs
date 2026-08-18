import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import pino from "pino";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createInternetSearchTool, type SearchClient } from "./tavily-tool.js";

const logger = pino({ level: "silent" });

function fakeClient(response: {
  results: Array<{ title: string; url: string; content: string }>;
  answer?: string;
}): SearchClient {
  return {
    search: async () => response,
  };
}

function failingClient(message: string): SearchClient {
  return {
    search: async () => {
      throw new Error(message);
    },
  };
}

describe("createInternetSearchTool", () => {
  let notesDir: string;

  beforeEach(async () => {
    notesDir = await mkdtemp(path.join(tmpdir(), "notes-"));
  });

  afterEach(async () => {
    await rm(notesDir, { recursive: true, force: true });
  });

  it("is exposed to the agent as internet_search", () => {
    const searchTool = createInternetSearchTool({
      client: fakeClient({ results: [] }),
      maxResults: 5,
      notesDir,
      logger,
    });
    expect(searchTool.name).toBe("internet_search");
  });

  it("returns the answer plus title, url and truncated content per result", async () => {
    const searchTool = createInternetSearchTool({
      client: fakeClient({
        answer: "A concise answer.",
        results: [
          { title: "T", url: "https://example.com", content: "x".repeat(3000) },
        ],
      }),
      maxResults: 5,
      notesDir,
      logger,
    });
    const raw = (await searchTool.invoke({ query: "anything" })) as string;
    const parsed = JSON.parse(raw) as {
      answer?: string;
      results: Array<{ title: string; url: string; content: string }>;
    };
    expect(parsed.answer).toBe("A concise answer.");
    expect(parsed.results).toHaveLength(1);
    expect(parsed.results[0]?.url).toBe("https://example.com");
    expect(parsed.results[0]?.content.length).toBeLessThanOrEqual(1800);
  });

  it("archives the full untruncated results to the notes directory", async () => {
    const searchTool = createInternetSearchTool({
      client: fakeClient({
        answer: "Short answer.",
        results: [
          {
            title: "Long page",
            url: "https://example.com/long",
            content: "y".repeat(3000),
          },
        ],
      }),
      maxResults: 5,
      notesDir,
      logger,
    });
    await searchTool.invoke({ query: "What is the thing?" });
    const files = await readdir(notesDir);
    expect(files).toEqual(["1-what-is-the-thing.md"]);
    const note = await readFile(path.join(notesDir, files[0] ?? ""), "utf8");
    expect(note).toContain("What is the thing?");
    expect(note).toContain("https://example.com/long");
    expect(note).toContain("y".repeat(3000));
  });

  it("numbers note files by search sequence", async () => {
    const searchTool = createInternetSearchTool({
      client: fakeClient({ results: [] }),
      maxResults: 5,
      notesDir,
      logger,
    });
    await searchTool.invoke({ query: "first query" });
    await searchTool.invoke({ query: "second query" });
    const files = (await readdir(notesDir)).sort();
    expect(files).toEqual(["1-first-query.md", "2-second-query.md"]);
  });

  it("returns a structured error to the model instead of throwing", async () => {
    const searchTool = createInternetSearchTool({
      client: failingClient("network down"),
      maxResults: 5,
      notesDir,
      logger,
    });
    const raw = (await searchTool.invoke({ query: "anything" })) as string;
    const parsed = JSON.parse(raw) as { error?: string };
    expect(parsed.error).toContain("network down");
    expect(await readdir(notesDir)).toEqual([]);
  });
});
