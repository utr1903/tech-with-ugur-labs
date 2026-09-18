import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { StructuredToolInterface } from "@langchain/core/tools";
import type { BaseCheckpointSaver } from "@langchain/langgraph";
import { createAgent, dynamicSystemPromptMiddleware } from "langchain";
import type { Logger } from "../logger.js";
import { createInterruptedToolCallsMiddleware } from "./interrupted-tool-calls-middleware.js";
import { createStepLoggingMiddleware } from "./step-logging-middleware.js";
import { buildSystemPrompt } from "./system-prompt.js";

// The tool list is fixed here, at build time. The system prompt is not: a
// server can outlive midnight, so `now` is called fresh on every model turn
// (via dynamicSystemPromptMiddleware) instead of being baked in once here.
// Middleware runs outermost first: the system prompt is set, then any tool
// call an interrupted turn left unanswered is answered, and step logging sits
// innermost so it wraps the model call with exactly the messages sent.
export function buildAgent({
  model,
  tools,
  checkpointer,
  logger,
  now,
}: {
  model: BaseChatModel;
  tools: StructuredToolInterface[];
  checkpointer: BaseCheckpointSaver;
  logger: Logger;
  now: () => Date;
}) {
  return createAgent({
    model,
    tools,
    checkpointer,
    middleware: [
      dynamicSystemPromptMiddleware(() => buildSystemPrompt(now())),
      createInterruptedToolCallsMiddleware({ logger }),
      createStepLoggingMiddleware({ logger }),
    ],
  });
}

export type ChatAgent = ReturnType<typeof buildAgent>;
