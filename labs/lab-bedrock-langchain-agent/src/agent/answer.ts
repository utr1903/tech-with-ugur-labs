import type { DynamicStructuredTool } from "@langchain/core/tools";
import { AGENT_RECURSION_LIMIT, REQUEST_TIMEOUT_MS } from "../config.js";
import type { Logger } from "../logger.js";
import { buildAgent } from "./agent.js";
import type { ModelEntry } from "./models.js";
import { summarizeToolCalls, type ToolCallSummary } from "./tool-calls.js";
import { trimAnswer } from "./trim-answer.js";

/** The result of one question. */
type Answer = { answer: string; toolCalls: ToolCallSummary[] };

/** Answers one question on one model. The server depends on this type only. */
export type AnswerQuestion = (input: {
  entry: ModelEntry;
  query: string;
  logger: Logger;
}) => Promise<Answer>;

/**
 * Creates the function that runs a question through a freshly built agent.
 * Both limits are applied here: the step limit stops a model that keeps
 * calling tools, the timeout stops a request that hangs.
 */
export function createAnswerQuestion({
  region,
  tools,
}: {
  region: string;
  tools: DynamicStructuredTool[];
}): AnswerQuestion {
  return async ({ entry, query, logger }) => {
    const agent = buildAgent({
      entry,
      region,
      tools,
      logger,
      today: new Date(),
    });
    const result = await agent.invoke(
      { messages: [{ role: "user", content: query }] },
      {
        recursionLimit: AGENT_RECURSION_LIMIT,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      },
    );
    return {
      answer: trimAnswer(result.messages.at(-1)?.text ?? ""),
      toolCalls: summarizeToolCalls(result.messages),
    };
  };
}
