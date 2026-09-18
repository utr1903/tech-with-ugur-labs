import {
  AIMessage,
  type BaseMessage,
  HumanMessage,
  ToolMessage,
} from "@langchain/core/messages";
import pino from "pino";
import { describe, expect, it } from "vitest";
import {
  answerInterruptedToolCalls,
  createInterruptedToolCallsMiddleware,
} from "./interrupted-tool-calls-middleware.js";

function aiCalling(...ids: string[]): AIMessage {
  return new AIMessage({
    content: "",
    tool_calls: ids.map((id) => ({
      id,
      name: "code_executor",
      args: { code: "print(1)" },
      type: "tool_call" as const,
    })),
  });
}

function answer(id: string): ToolMessage {
  return new ToolMessage({
    content: '{"status":"succeeded"}',
    tool_call_id: id,
  });
}

function describeMessages(messages: readonly BaseMessage[]): string[] {
  return messages.map((m) =>
    m.getType() === "tool"
      ? `tool:${(m as ToolMessage).tool_call_id}`
      : m.getType(),
  );
}

describe("answerInterruptedToolCalls", () => {
  it("inserts an interrupted tool message directly after the unanswered call", () => {
    const messages = [
      new HumanMessage("first"),
      aiCalling("c1"),
      new HumanMessage("second"),
    ];
    const repaired = answerInterruptedToolCalls(messages);
    expect(describeMessages(repaired)).toEqual([
      "human",
      "ai",
      "tool:c1",
      "human",
    ]);
    const synthetic = repaired[2] as ToolMessage;
    expect(synthetic.name).toBe("code_executor");
    expect(JSON.parse(String(synthetic.content))).toEqual({
      error: "interrupted",
      message: "The previous run was interrupted before the sandbox answered.",
    });
  });

  it("returns the same messages when every tool call is answered", () => {
    const messages = [
      new HumanMessage("q"),
      aiCalling("c1"),
      answer("c1"),
      new AIMessage("done"),
    ];
    expect(answerInterruptedToolCalls(messages)).toBe(messages);
  });

  it("repairs only the calls that are missing an answer", () => {
    const messages = [
      new HumanMessage("q1"),
      aiCalling("a1", "a2"),
      answer("a1"),
      new AIMessage("done"),
      new HumanMessage("q2"),
      aiCalling("b1"),
      new HumanMessage("q3"),
      aiCalling("c1"),
      answer("c1"),
    ];
    expect(describeMessages(answerInterruptedToolCalls(messages))).toEqual([
      "human",
      "ai",
      "tool:a2",
      "tool:a1",
      "ai",
      "human",
      "ai",
      "tool:b1",
      "human",
      "ai",
      "tool:c1",
    ]);
  });
});

describe("interrupted tool calls middleware", () => {
  const logger = pino({ level: "silent" });

  it("hands the model the repaired messages", async () => {
    const middleware = createInterruptedToolCallsMiddleware({ logger });
    const request = {
      messages: [
        new HumanMessage("q"),
        aiCalling("c1"),
        new HumanMessage("again"),
      ],
    };
    let seen: readonly BaseMessage[] = [];
    await middleware.wrapModelCall?.(request as never, async (req) => {
      seen = req.messages;
      return new AIMessage("ok");
    });
    expect(describeMessages(seen)).toEqual(["human", "ai", "tool:c1", "human"]);
    expect(request.messages).toHaveLength(3);
  });

  it("passes the request through untouched when nothing is missing", async () => {
    const middleware = createInterruptedToolCallsMiddleware({ logger });
    const request = { messages: [new HumanMessage("q")] };
    let seen: unknown;
    await middleware.wrapModelCall?.(request as never, async (req) => {
      seen = req;
      return new AIMessage("ok");
    });
    expect(seen).toBe(request);
  });
});
