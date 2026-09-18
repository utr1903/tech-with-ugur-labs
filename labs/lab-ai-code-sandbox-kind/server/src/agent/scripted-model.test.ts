import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { describe, expect, it } from "vitest";
import { CAFE_SOLVER_CODE } from "./cafe-script.js";
import { planNextMessage, ScriptedChatModel } from "./scripted-model.js";

const toolContent = JSON.stringify({
  status: "succeeded",
  result: { solution: { coffee: 3, tea: 2, sandwich: 5 }, maxResidual: 0 },
});

describe("planNextMessage", () => {
  it("asks code_executor to run the solver on a new question", () => {
    const message = planNextMessage([new HumanMessage("anything")]);
    expect(message.tool_calls).toHaveLength(1);
    expect(message.tool_calls?.[0]?.name).toBe("code_executor");
    expect(message.tool_calls?.[0]?.args).toEqual({ code: CAFE_SOLVER_CODE });
    expect(message.id).toBeTruthy();
  });

  it("answers from the tool message that follows the latest question", () => {
    const call = planNextMessage([new HumanMessage("q")]);
    const callId = call.tool_calls?.[0]?.id ?? "";
    const message = planNextMessage([
      new HumanMessage("q"),
      call,
      new ToolMessage({ content: toolContent, tool_call_id: callId }),
    ]);
    expect(message.tool_calls ?? []).toHaveLength(0);
    expect(String(message.content)).toContain("| sandwich | 5 |");
  });

  it("starts a new tool call for a follow-up question in the same thread", () => {
    const earlier = [
      new HumanMessage("q1"),
      new AIMessage({
        content: "",
        tool_calls: [{ id: "c1", name: "code_executor", args: {} }],
      }),
      new ToolMessage({ content: toolContent, tool_call_id: "c1" }),
      new AIMessage("### Model ..."),
    ];
    const message = planNextMessage([...earlier, new HumanMessage("q2")]);
    expect(message.tool_calls).toHaveLength(1);
  });
});

describe("ScriptedChatModel", () => {
  it("supports bindTools and streams a tool call then a text answer", async () => {
    const model = new ScriptedChatModel({});
    const bound = model.bindTools([]);
    const first = await bound.invoke([new HumanMessage("q")]);
    expect(first.tool_calls?.[0]?.name).toBe("code_executor");

    const chunks = [];
    const stream = await model.stream([
      new HumanMessage("q"),
      new AIMessage({
        content: "",
        tool_calls: [{ id: "c1", name: "code_executor", args: {} }],
      }),
      new ToolMessage({ content: toolContent, tool_call_id: "c1" }),
    ]);
    for await (const chunk of stream) chunks.push(chunk);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.map((c) => c.content).join("")).toContain("### Verification");
  });
});
