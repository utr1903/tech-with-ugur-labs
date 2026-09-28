import { ToolMessage } from "@langchain/core/messages";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { createAgent, FakeToolCallingModel } from "langchain";
import pino from "pino";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createStepLoggingMiddleware } from "./logging-middleware.js";

function captureLogs() {
  const lines: Record<string, unknown>[] = [];
  const logger = pino(
    { level: "info" },
    { write: (line: string) => lines.push(JSON.parse(line)) },
  );
  return { logger, lines };
}

function probeTool(behaviour: "ok" | "throw" | "abort") {
  return new DynamicStructuredTool({
    name: "probe",
    description: "probe",
    schema: z.object({ id: z.number().int() }),
    func: async () => {
      if (behaviour === "throw") throw new Error("secret /home/node/.aws path");
      if (behaviour === "abort") {
        throw Object.assign(new Error("aborted"), { name: "AbortError" });
      }
      return JSON.stringify({ ok: true, rows: [], total: 0, truncated: false });
    },
  });
}

/** A probe tool with an enum field, to check the message for that kind of rejection. */
function enumProbeTool() {
  return new DynamicStructuredTool({
    name: "probe",
    description: "probe",
    schema: z.object({ status: z.enum(["pending", "shipped"]) }),
    func: async () =>
      JSON.stringify({ ok: true, rows: [], total: 0, truncated: false }),
  });
}

/** Runs one probe tool call through the middleware and captures its log lines. */
async function runWithTool(
  tool: DynamicStructuredTool,
  args: Record<string, unknown>,
) {
  const { logger, lines } = captureLogs();
  const agent = createAgent({
    model: new FakeToolCallingModel({
      toolCalls: [[{ id: "1", name: "probe", args }], []],
    }),
    tools: [tool],
    middleware: [createStepLoggingMiddleware({ logger })],
  });
  const result = await agent.invoke({
    messages: [{ role: "user", content: "go" }],
  });
  return { lines, result };
}

async function run(
  behaviour: "ok" | "throw" | "abort",
  args: Record<string, unknown>,
) {
  return runWithTool(probeTool(behaviour), args);
}

describe("step logging middleware", () => {
  it("logs start and success for every model turn and tool call", async () => {
    const { lines } = await run("ok", { id: 1 });
    expect(lines.map((line) => line.msg)).toEqual([
      "Model turn...",
      "Model turn succeeded.",
      "Tool call...",
      "Tool call succeeded.",
      "Model turn...",
      "Model turn succeeded.",
    ]);
    expect(lines[0]).toMatchObject({ turn: 1 });
    expect(lines[2]).toMatchObject({ tool: "probe", args: { id: 1 } });
    expect(lines[3]).toMatchObject({ tool: "probe", total: 0 });
    expect(lines[3]).toHaveProperty("durationMs");
  });

  it("returns a structured error to the model when a tool fails", async () => {
    const { lines, result } = await run("throw", { id: 1 });
    const failure = lines.find((line) => line.msg === "Tool call failed.");
    expect(failure).toMatchObject({
      tool: "probe",
      errorName: "Error",
      code: "TOOL_CALL_FAILED",
    });
    expect(JSON.stringify(lines)).not.toContain(".aws");
    const toolMessage = result.messages.find(
      (message) => message.getType() === "tool",
    );
    expect(JSON.parse(String(toolMessage?.content))).toEqual({
      ok: false,
      error: {
        code: "TOOL_CALL_FAILED",
        message:
          "The tool call failed. Check the arguments against the tool's schema and try again.",
      },
    });
  });

  it("re-throws instead of swallowing an aborted or timed-out tool call", async () => {
    const { logger } = captureLogs();
    const agent = createAgent({
      model: new FakeToolCallingModel({
        toolCalls: [[{ id: "1", name: "probe", args: { id: 1 } }], []],
      }),
      tools: [probeTool("abort")],
      middleware: [createStepLoggingMiddleware({ logger })],
    });
    await expect(
      agent.invoke({ messages: [{ role: "user", content: "go" }] }),
    ).rejects.toThrow();
  });
});

describe("step logging middleware: arguments that do not fit the schema", () => {
  it("names the offending field and continues to a final answer", async () => {
    const { lines, result } = await run("ok", { id: "one" });
    const failure = lines.find((line) => line.msg === "Tool call failed.");
    expect(failure).toMatchObject({ tool: "probe", code: "INVALID_ARGUMENTS" });
    const toolMessage = result.messages.find(
      (message) => message.getType() === "tool",
    );
    const content = JSON.parse(String(toolMessage?.content)) as {
      ok: boolean;
      error: { code: string; message: string };
    };
    expect(content.ok).toBe(false);
    expect(content.error.code).toBe("INVALID_ARGUMENTS");
    expect(content.error.message).toContain("id: ");
    expect(content.error.message.length).toBeLessThanOrEqual(500);
    expect(result.messages.at(-1)?.getType()).toBe("ai");
  });

  it("names the offending field when an enum value is rejected", async () => {
    const { result } = await runWithTool(enumProbeTool(), { status: "lost" });
    const toolMessage = result.messages.find(
      (message) => message.getType() === "tool",
    );
    const content = JSON.parse(String(toolMessage?.content)) as {
      error: { message: string };
    };
    expect(content.error.message).toContain("status");
  });
});

describe("step logging middleware: a call whose tool cannot be found", () => {
  it("returns the generic failure instead of throwing", async () => {
    const { logger, lines } = captureLogs();
    const middleware = createStepLoggingMiddleware({ logger });
    const request = {
      toolCall: { id: "1", name: "missing", args: { id: "one" } },
      tool: undefined,
    };
    const result = await middleware.wrapToolCall?.(request as never, () => {
      throw new Error("tool not found");
    });
    expect(ToolMessage.isInstance(result)).toBe(true);
    expect(JSON.parse(String((result as ToolMessage).content))).toMatchObject({
      ok: false,
      error: { code: "TOOL_CALL_FAILED" },
    });
    expect(lines.at(-1)).toMatchObject({
      msg: "Tool call failed.",
      code: "TOOL_CALL_FAILED",
    });
  });
});
