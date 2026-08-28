import type { DynamicStructuredTool } from "@langchain/core/tools";
import type { ChatOllama } from "@langchain/ollama";
import { createAgent, type FakeToolCallingModel } from "langchain";
import { createGuardrailMiddleware } from "./guard/guardrail-middleware.js";
import type { Logger } from "./logger.js";
import { createStepLoggingMiddleware } from "./logging-middleware.js";

const SYSTEM_PROMPT =
  "You are a repository helper. Use the available tools to answer the user's request.";

export interface BuildAgentDeps {
  model: ChatOllama | FakeToolCallingModel;
  tools: DynamicStructuredTool[];
  guard: boolean;
  logger: Logger;
}

// Wires the ReAct agent that every run of this lab drives: the step logger
// always runs (it's the operator's audit trail); the guardrail middleware
// (Task 7) is added only when `guard` is on, so the same agent shape can
// demonstrate both the vulnerable and the defended path.
export function buildAgent(
  deps: BuildAgentDeps,
): ReturnType<typeof createAgent> {
  const { model, tools, guard, logger } = deps;

  return createAgent({
    model,
    tools,
    systemPrompt: SYSTEM_PROMPT,
    middleware: [
      createStepLoggingMiddleware({ logger }),
      ...(guard ? [createGuardrailMiddleware({ logger })] : []),
    ],
  });
}
