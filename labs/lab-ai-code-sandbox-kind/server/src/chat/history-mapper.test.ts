import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
} from "@langchain/core/messages";
import { describe, expect, it } from "vitest";
import { toUIMessages } from "./history-mapper.js";

describe("toUIMessages", () => {
  it("returns an empty list for an empty thread", () => {
    expect(toUIMessages([])).toEqual([]);
  });

  it("groups one turn's AI and tool messages into a single assistant message", () => {
    const messages = [
      new SystemMessage("ignored"),
      new HumanMessage({ id: "h1", content: "solve it" }),
      new AIMessage({
        id: "a1",
        content: "",
        tool_calls: [
          { id: "c1", name: "code_executor", args: { code: "print(1)" } },
        ],
      }),
      new ToolMessage({
        id: "t1",
        content: '{"status":"succeeded"}',
        tool_call_id: "c1",
      }),
      new AIMessage({ id: "a2", content: "### Model\n..." }),
    ];
    expect(toUIMessages(messages)).toEqual([
      { id: "h1", role: "user", parts: [{ type: "text", text: "solve it" }] },
      {
        id: "a1",
        role: "assistant",
        parts: [
          {
            type: "dynamic-tool",
            toolName: "code_executor",
            toolCallId: "c1",
            state: "output-available",
            input: { code: "print(1)" },
            output: '{"status":"succeeded"}',
          },
          { type: "text", text: "### Model\n...", state: "done" },
        ],
      },
    ]);
  });

  it("keeps separate turns separate and reads text from content blocks", () => {
    const messages = [
      new HumanMessage({
        id: "h1",
        content: [{ type: "text", text: "first" }],
      }),
      new AIMessage({ id: "a1", content: [{ type: "text", text: "one" }] }),
      new HumanMessage({ id: "h2", content: "second" }),
      new AIMessage({ id: "a2", content: "two" }),
    ];
    const ui = toUIMessages(messages);
    expect(ui.map((m) => [m.role, m.id])).toEqual([
      ["user", "h1"],
      ["assistant", "a1"],
      ["user", "h2"],
      ["assistant", "a2"],
    ]);
    expect(ui[0]?.parts).toEqual([{ type: "text", text: "first" }]);
  });

  it("leaves a tool call without a result in input-available state", () => {
    const ui = toUIMessages([
      new HumanMessage({ id: "h1", content: "q" }),
      new AIMessage({
        id: "a1",
        content: "",
        tool_calls: [{ id: "c1", name: "code_executor", args: {} }],
      }),
    ]);
    expect(ui[1]?.parts[0]).toMatchObject({
      type: "dynamic-tool",
      state: "input-available",
    });
  });
});
