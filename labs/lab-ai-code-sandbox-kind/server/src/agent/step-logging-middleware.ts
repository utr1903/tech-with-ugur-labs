import { createMiddleware } from "langchain";
import type { Logger } from "../logger.js";

const MAX_ARGS_CHARS = 300;

// Logs every step of an agent run at operation boundaries: each model turn
// and each tool call, start / success / failure.
export function createStepLoggingMiddleware({ logger }: { logger: Logger }) {
  return createMiddleware({
    name: "StepLoggingMiddleware",
    wrapModelCall: async (request, handler) => {
      const startedAt = Date.now();
      logger.info(
        { messageCount: request.messages.length },
        "Model turn starting...",
      );
      try {
        const result = await handler(request);
        logger.info(
          {
            durationMs: Date.now() - startedAt,
            toolCallsRequested: (result.tool_calls ?? []).map((c) => c.name),
          },
          "Model turn succeeded.",
        );
        return result;
      } catch (err) {
        logger.error(
          { err, durationMs: Date.now() - startedAt },
          "Model turn failed.",
        );
        throw err;
      }
    },
    wrapToolCall: async (request, handler) => {
      const tool = request.toolCall.name;
      const args = JSON.stringify(request.toolCall.args ?? {}).slice(
        0,
        MAX_ARGS_CHARS,
      );
      const startedAt = Date.now();
      logger.info({ tool, args }, "Tool call starting...");
      try {
        const result = await handler(request);
        logger.info(
          { tool, durationMs: Date.now() - startedAt },
          "Tool call succeeded.",
        );
        return result;
      } catch (err) {
        logger.error(
          { err, tool, durationMs: Date.now() - startedAt },
          "Tool call failed.",
        );
        throw err;
      }
    },
  });
}
