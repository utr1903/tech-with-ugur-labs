import { ToolMessage } from "@langchain/core/messages";
import {
  createMiddleware,
  type WrapModelCallHook,
  type WrapToolCallHook,
} from "langchain";
import type { Logger } from "../logger.js";
import { describeError } from "./describe-error.js";

const TOOL_CALL_FAILED = JSON.stringify({
  ok: false,
  error: {
    code: "TOOL_CALL_FAILED",
    message:
      "The tool call failed. Check the arguments against the tool's schema and try again.",
  },
});

/** Reads the row total from a tool result for the success log line. */
function readTotal(result: unknown): number | null {
  try {
    const content = ToolMessage.isInstance(result) ? result.content : result;
    const total = (JSON.parse(String(content)) as { total?: unknown }).total;
    return typeof total === "number" ? total : null;
  } catch {
    return null;
  }
}

/** True for an abort or a timeout, which must end the request, not become a tool result. */
function isAbortOrTimeout(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.name === "AbortError" || err.name === "TimeoutError")
  );
}

/**
 * Logs one model turn at start, success and failure. Turns are counted from
 * 1 across the whole agent run, so the counter lives in this closure.
 */
function createWrapModelCall(logger: Logger): WrapModelCallHook {
  let turn = 0;
  return async (request, handler) => {
    turn += 1;
    const thisTurn = turn;
    const startedAt = Date.now();
    logger.info(
      { turn: thisTurn, messageCount: request.messages.length },
      "Model turn...",
    );
    try {
      const result = await handler(request);
      logger.info(
        {
          turn: thisTurn,
          durationMs: Date.now() - startedAt,
          toolCallsRequested: (result.tool_calls ?? []).map(
            (call) => call.name,
          ),
          usage: result.usage_metadata,
        },
        "Model turn succeeded.",
      );
      return result;
    } catch (err) {
      logger.error(
        {
          ...describeError(err),
          turn: thisTurn,
          durationMs: Date.now() - startedAt,
        },
        "Model turn failed.",
      );
      throw err;
    }
  };
}

/**
 * Logs one tool call at start, success and failure, and turns most failures
 * into a result the model can react to instead of ending the request.
 */
function createWrapToolCall(logger: Logger): WrapToolCallHook {
  return async (request, handler) => {
    const tool = request.toolCall.name;
    const args = request.toolCall.args ?? {};
    const startedAt = Date.now();
    logger.info({ tool, args }, "Tool call...");
    try {
      const result = await handler(request);
      logger.info(
        { tool, total: readTotal(result), durationMs: Date.now() - startedAt },
        "Tool call succeeded.",
      );
      return result;
    } catch (err) {
      logger.error(
        { ...describeError(err), tool, durationMs: Date.now() - startedAt },
        "Tool call failed.",
      );
      // An abort or a timeout must still end the request: it is not a bad
      // argument the model can recover from, so it is re-thrown instead of
      // being turned into a tool result.
      if (isAbortOrTimeout(err)) {
        throw err;
      }
      // Deliberately not re-thrown otherwise: a failed tool call becomes a
      // result the model can react to, so one bad argument does not end
      // the request.
      return new ToolMessage({
        tool_call_id: request.toolCall.id ?? "",
        name: tool,
        content: TOOL_CALL_FAILED,
      });
    }
  };
}

/**
 * Logs every model turn and every tool call at start, success and failure,
 * so an agent run can be followed step by step in `make logs`. One instance
 * serves one request; pass a logger that already carries the request id.
 */
export function createStepLoggingMiddleware({ logger }: { logger: Logger }) {
  return createMiddleware({
    name: "StepLoggingMiddleware",
    wrapModelCall: createWrapModelCall(logger),
    wrapToolCall: createWrapToolCall(logger),
  });
}
