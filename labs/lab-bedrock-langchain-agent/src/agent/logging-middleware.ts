import { ToolMessage } from "@langchain/core/messages";
import {
  createMiddleware,
  type ToolCallRequest,
  type WrapModelCallHook,
  type WrapToolCallHook,
} from "langchain";
import type { Logger } from "../logger.js";
import { describeError } from "./describe-error.js";
import { describeInvalidArguments } from "./invalid-arguments.js";
import { readOutcome } from "./tool-calls.js";

const TOOL_CALL_FAILED = JSON.stringify({
  ok: false,
  error: {
    code: "TOOL_CALL_FAILED",
    message:
      "The tool call failed. Check the arguments against the tool's schema and try again.",
  },
});

/** True for an abort or a timeout, which must end the request, not become a tool result. */
function isAbortOrTimeout(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.name === "AbortError" || err.name === "TimeoutError")
  );
}

/**
 * Checks the failed call's arguments against the schema of the tool being
 * called. Returns the per-field message when they do not fit, and `null`
 * when they fit, when the tool is unknown, or when the check itself fails:
 * this runs inside error handling and must never throw.
 */
function invalidArgumentsMessage(request: ToolCallRequest): string | null {
  try {
    const schema = request.tool?.schema;
    return describeInvalidArguments(schema, request.toolCall.args);
  } catch {
    return null;
  }
}

/**
 * The tool result the model gets for a failed call: the per-field message
 * when the arguments did not fit the schema, the generic one otherwise.
 */
function failedToolMessage(
  request: ToolCallRequest,
  invalidArguments: string | null,
): ToolMessage {
  const content = invalidArguments
    ? JSON.stringify({
        ok: false,
        error: { code: "INVALID_ARGUMENTS", message: invalidArguments },
      })
    : TOOL_CALL_FAILED;
  return new ToolMessage({
    tool_call_id: request.toolCall.id ?? "",
    name: request.toolCall.name,
    content,
  });
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
        {
          tool,
          total: readOutcome(
            ToolMessage.isInstance(result) ? result.content : result,
          ).total,
          durationMs: Date.now() - startedAt,
        },
        "Tool call succeeded.",
      );
      return result;
    } catch (err) {
      // An abort or a timeout must still end the request: it is not a bad
      // argument the model can recover from, so it is re-thrown below
      // instead of being turned into a tool result.
      const abortOrTimeout = isAbortOrTimeout(err);
      // Arguments that do not fit the tool's schema get their own code and
      // a message naming the offending fields, so the model can correct
      // itself instead of repeating the same call. Every other failure
      // (a database error, a bug in a tool) keeps the generic message.
      const invalidArguments = abortOrTimeout
        ? null
        : invalidArgumentsMessage(request);
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
      if (abortOrTimeout) {
        throw err;
      }
      // Deliberately not re-thrown otherwise: a failed tool call becomes a
      // result the model can react to, so one bad argument does not end
      // the request.
      return failedToolMessage(request, invalidArguments);
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
