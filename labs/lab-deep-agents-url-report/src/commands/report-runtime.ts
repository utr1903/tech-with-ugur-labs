import { setTimeout } from "node:timers/promises";
import { ChatOpenAI } from "@langchain/openai";
import type { Logger } from "../logger.js";
import {
  createFirecrawlClient,
  createResearchTools,
} from "../research/firecrawl-tools.js";
import type { ResearchRequest } from "../research/input.js";
import { createLedger } from "../research/ledger.js";

export function createReportRuntime(request: ResearchRequest, logger: Logger) {
  const openaiKey = process.env.OPENAI_API_KEY;
  const firecrawlKey = process.env.FIRECRAWL_API_KEY;
  if (!openaiKey || !firecrawlKey)
    throw new Error("OPENAI_API_KEY and FIRECRAWL_API_KEY are required.");
  return {
    model: new ChatOpenAI({
      model: "gpt-4.1-mini",
      apiKey: openaiKey,
      maxRetries: 0,
      timeout: 180_000,
    }),
    tools: createResearchTools({
      firecrawl: createFirecrawlClient(firecrawlKey),
      ledger: createLedger(request),
      logger,
      clock: {
        now: () => Date.now(),
        sleep: async (ms) => {
          await setTimeout(ms);
        },
      },
    }),
  };
}
