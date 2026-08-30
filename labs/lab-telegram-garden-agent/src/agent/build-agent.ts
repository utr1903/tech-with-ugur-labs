import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { DynamicStructuredTool } from "@langchain/core/tools";
import { createAgent, type createMiddleware } from "langchain";
import type { Logger } from "../logger.js";
import { createStepLoggingMiddleware } from "./logging-middleware.js";
import { buildSystemPrompt } from "./prompts.js";

export interface BuildAgentDeps {
  model: BaseChatModel;
  tools: DynamicStructuredTool[];
  logger: Logger;
  extraMiddleware?: ReturnType<typeof createMiddleware>[];
}

// The step logger always runs (the operator's audit trail); callers add
// extra middleware — e.g. the scripted run's tool-call recorder.
export function buildAgent(
  deps: BuildAgentDeps,
): ReturnType<typeof createAgent> {
  const { model, tools, logger, extraMiddleware = [] } = deps;
  const todayIsoDate = new Date().toISOString().slice(0, 10);
  return createAgent({
    model,
    tools,
    systemPrompt: buildSystemPrompt({ todayIsoDate }),
    middleware: [createStepLoggingMiddleware({ logger }), ...extraMiddleware],
  });
}
