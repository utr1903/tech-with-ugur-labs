import { execFile } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { beforeAll, describe, expect, it } from "vitest";
import { toTopicSlug } from "../src/search/topic-slug.js";

const execFileAsync = promisify(execFile);
const QUESTION = "What is the Model Context Protocol and who created it?";
const RESEARCH_DIR = "research-e2e";
const TSX = path.join("node_modules", ".bin", "tsx");

function runCli(args: string[]): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync(TSX, ["src/index.ts", ...args], {
    env: { ...process.env, RESEARCH_DIR },
    maxBuffer: 16 * 1024 * 1024,
  });
}

describe("local deep research smoke", () => {
  beforeAll(async () => {
    await rm(RESEARCH_DIR, { recursive: true, force: true });
  });

  it("search writes a non-trivial cited report", async () => {
    await runCli(["search", QUESTION]);
    const reportPath = path.join(
      RESEARCH_DIR,
      toTopicSlug(QUESTION),
      "report.md",
    );
    const report = await readFile(reportPath, "utf8");
    expect(report.length).toBeGreaterThan(400);
    expect(report).toMatch(/https?:\/\//);
  });

  it("analyze answers a question grounded in the researched files", async () => {
    const { stdout } = await runCli([
      "analyze",
      "According to the research files, who created the Model Context Protocol?",
    ]);
    const successLine = stdout
      .split("\n")
      .filter((line) => line.startsWith("{"))
      .map((line) => JSON.parse(line) as { msg?: string; answer?: string })
      .find(
        (entry) => entry.msg === "Answering from research files succeeded.",
      );
    expect(successLine).toBeDefined();
    const answer = successLine?.answer ?? "";
    expect(answer.length).toBeGreaterThan(20);
    expect(answer.toLowerCase()).toMatch(
      /model context protocol|mcp|anthropic/,
    );
  });
});
