import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { StructuredToolInterface } from "@langchain/core/tools";
import type { BaseCheckpointSaver } from "@langchain/langgraph";
import { createAgent } from "langchain";
import type { Logger } from "../logger.js";
import { createStepLoggingMiddleware } from "./step-logging-middleware.js";
import { buildSystemPrompt } from "./system-prompt.js";

// The tool list and its description are fixed here, at build time.
export function buildAgent({
  model,
  tools,
  checkpointer,
  logger,
  today,
}: {
  model: BaseChatModel;
  tools: StructuredToolInterface[];
  checkpointer: BaseCheckpointSaver;
  logger: Logger;
  today: Date;
}) {
  return createAgent({
    model,
    tools,
    systemPrompt: buildSystemPrompt(today),
    checkpointer,
    middleware: [createStepLoggingMiddleware({ logger })],
  });
}

export type ChatAgent = ReturnType<typeof buildAgent>;
