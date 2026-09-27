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

async function run(
  behaviour: "ok" | "throw" | "abort",
  args: Record<string, unknown>,
) {
  const { logger, lines } = captureLogs();
  const agent = createAgent({
    model: new FakeToolCallingModel({
      toolCalls: [[{ id: "1", name: "probe", args }], []],
    }),
    tools: [probeTool(behaviour)],
    middleware: [createStepLoggingMiddleware({ logger })],
  });
  const result = await agent.invoke({
    messages: [{ role: "user", content: "go" }],
  });
  return { lines, result };
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
    expect(failure).toMatchObject({ tool: "probe", errorName: "Error" });
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

  it("returns a structured error when the arguments do not fit the schema", async () => {
    const { lines, result } = await run("ok", { id: "one" });
    expect(lines.some((line) => line.msg === "Tool call failed.")).toBe(true);
    expect(result.messages.at(-1)?.getType()).toBe("ai");
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
