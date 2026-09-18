import { AIMessage, ToolMessage } from "@langchain/core/messages";
import pino from "pino";
import { describe, expect, it } from "vitest";
import { createStepLoggingMiddleware } from "./step-logging-middleware.js";

function captureLogger() {
  const lines: Record<string, unknown>[] = [];
  const logger = pino(
    { level: "info" },
    { write: (line: string) => lines.push(JSON.parse(line)) },
  );
  return { logger, lines };
}

describe("step logging middleware", () => {
  it("logs start and success of a model turn with requested tools", async () => {
    const { logger, lines } = captureLogger();
    const middleware = createStepLoggingMiddleware({ logger });
    const request = { messages: [] } as never;
    const result = new AIMessage({
      content: "",
      tool_calls: [{ id: "c1", name: "code_executor", args: {} }],
    });
    await middleware.wrapModelCall?.(request, async () => result);
    expect(lines.map((l) => l.msg)).toEqual([
      "Model turn starting...",
      "Model turn succeeded.",
    ]);
    expect(lines[1]?.toolCallsRequested).toEqual(["code_executor"]);
  });

  it("logs and re-throws a failing tool call", async () => {
    const { logger, lines } = captureLogger();
    const middleware = createStepLoggingMiddleware({ logger });
    const request = {
      toolCall: { id: "c1", name: "code_executor", args: { code: "x" } },
    } as never;
    await expect(
      middleware.wrapToolCall?.(request, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(lines.map((l) => l.msg)).toEqual([
      "Tool call starting...",
      "Tool call failed.",
    ]);
  });

  it("logs a successful tool call", async () => {
    const { logger, lines } = captureLogger();
    const middleware = createStepLoggingMiddleware({ logger });
    const request = {
      toolCall: { id: "c1", name: "code_executor", args: {} },
    } as never;
    await middleware.wrapToolCall?.(
      request,
      async () => new ToolMessage({ content: "{}", tool_call_id: "c1" }),
    );
    expect(lines.at(-1)?.msg).toBe("Tool call succeeded.");
  });
});
