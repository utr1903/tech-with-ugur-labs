import { ToolMessage } from "@langchain/core/messages";
import { ToolInputParsingException } from "@langchain/core/tools";
import {
  createMiddleware,
  ToolInvocationError,
  type WrapModelCallHook,
  type WrapToolCallHook,
} from "langchain";
import type { Logger } from "../logger.js";
import { describeError } from "./describe-error.js";
import { describeInvalidArguments } from "./invalid-arguments.js";

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
 * The agent runtime (`ToolNode`) catches a rejected call itself, before
 * `wrapToolCall` ever sees it, and re-throws it as a `ToolInvocationError`
 * whose `toolError` is the original exception. This unwraps it back to the
 * `ToolInputParsingException` when that is what happened, so its message
 * (the per-field zod issues) can be read; every other tool error is left
 * as-is and keeps the generic `TOOL_CALL_FAILED` result.
 */
function invalidArgumentsError(err: unknown): ToolInputParsingException | null {
  if (
    err instanceof ToolInvocationError &&
    err.toolError instanceof ToolInputParsingException
  ) {
    return err.toolError;
  }
  return null;
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
      // Arguments that do not fit the tool's schema get their own code and
      // a message naming the offending fields, so the model can correct
      // itself instead of repeating the same call. Every other failure
      // (a database error, a bug in a tool) keeps the generic message.
      const invalidArguments = invalidArgumentsError(err);
      const code = invalidArguments ? "INVALID_ARGUMENTS" : "TOOL_CALL_FAILED";
      logger.error(
        {
          ...describeError(err),
          tool,
          code,
          durationMs: Date.now() - startedAt,
        },
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
      const content = invalidArguments
        ? JSON.stringify({
            ok: false,
            error: {
              code,
              message: describeInvalidArguments(invalidArguments),
            },
          })
        : TOOL_CALL_FAILED;
      return new ToolMessage({
        tool_call_id: request.toolCall.id ?? "",
        name: tool,
        content,
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
