import { ChatBedrockConverse } from "@langchain/aws";
import type { DynamicStructuredTool } from "@langchain/core/tools";
import { createAgent } from "langchain";
import { MAX_OUTPUT_TOKENS } from "../config.js";
import type { Logger } from "../logger.js";
import { createStepLoggingMiddleware } from "./logging-middleware.js";
import type { ModelEntry } from "./models.js";
import { buildSystemPrompt } from "./prompt.js";

/**
 * Builds the agent for one request. Only the model differs between the four
 * registry entries: tools, prompt and logging are the same. No credentials
 * are passed; the AWS SDK finds the `aws login` session on its own.
 */
export function buildAgent({
  entry,
  region,
  tools,
  logger,
  today,
}: {
  entry: ModelEntry;
  region: string;
  tools: DynamicStructuredTool[];
  logger: Logger;
  today: Date;
}) {
  const model = new ChatBedrockConverse({
    model: entry.bedrockId,
    region,
    maxTokens: MAX_OUTPUT_TOKENS,
    ...(entry.sendTemperature ? { temperature: 0 } : {}),
  });
  return createAgent({
    model,
    tools,
    systemPrompt: buildSystemPrompt(today),
    middleware: [createStepLoggingMiddleware({ logger })],
  });
}
