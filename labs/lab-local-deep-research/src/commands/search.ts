import { access, mkdir } from "node:fs/promises";
import path from "node:path";
import { tavily } from "@tavily/core";
import { buildChatModel } from "../agents/model.js";
import { buildResearchInstruction } from "../agents/prompts.js";
import { buildResearchAgent } from "../agents/research-agent.js";
import type { AppConfig } from "../config.js";
import type { Logger } from "../logger.js";
import { createInternetSearchTool } from "../search/tavily-tool.js";
import { toTopicSlug } from "../search/topic-slug.js";

function isRecursionLimitError(err: unknown): boolean {
  return err instanceof Error && err.name === "GraphRecursionError";
}

export async function runSearch({
  question,
  config,
  logger,
}: {
  question: string;
  config: AppConfig;
  logger: Logger;
}): Promise<{ reportPath: string }> {
  try {
    logger.info({ question }, "Running deep research...");
    if (config.tavilyApiKey === undefined || config.tavilyApiKey === "") {
      throw new Error(
        "TAVILY_API_KEY is not set. Copy .env.example to .env and add your key.",
      );
    }
    const slug = toTopicSlug(question);
    const topicDir = path.resolve(config.researchDir, slug);
    await mkdir(topicDir, { recursive: true });

    const researchLogger = logger.child({ domain: "research" });
    const searchTool = createInternetSearchTool({
      client: tavily({ apiKey: config.tavilyApiKey }),
      maxResults: config.searchMaxResults,
      notesDir: path.join(topicDir, "notes"),
      logger: researchLogger,
    });
    const agent = buildResearchAgent({
      model: buildChatModel(config),
      searchTool,
      topicDir,
      today: new Date().toISOString().slice(0, 10),
      logger: researchLogger,
    });

    try {
      await agent.invoke(
        {
          messages: [
            { role: "user", content: buildResearchInstruction(question) },
          ],
        },
        { recursionLimit: config.maxAgentSteps },
      );
    } catch (err) {
      if (!isRecursionLimitError(err)) throw err;
      logger.warn(
        { question, maxAgentSteps: config.maxAgentSteps },
        "Running deep research hit the step budget; checking for a report anyway.",
      );
    }

    const reportPath = path.join(topicDir, "report.md");
    try {
      await access(reportPath);
    } catch (accessErr) {
      throw new Error(
        "The agent finished without writing report.md — try raising MAX_AGENT_STEPS in .env or re-running.",
        { cause: accessErr },
      );
    }
    logger.info({ question, reportPath }, "Running deep research succeeded.");
    return { reportPath };
  } catch (err) {
    logger.error({ err, question }, "Running deep research failed.");
    throw err;
  }
}
