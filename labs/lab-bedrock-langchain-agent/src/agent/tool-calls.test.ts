import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { describe, expect, it } from "vitest";
import { summarizeToolCalls } from "./tool-calls.js";

describe("summarizeToolCalls", () => {
  it("pairs each requested call with its result, in order", () => {
    const messages = [
      new HumanMessage("question"),
      new AIMessage({
        content: "",
        tool_calls: [
          { id: "a", name: "query_customers", args: { name: "Ann" } },
          { id: "b", name: "query_orders", args: { customer_id: 3 } },
        ],
      }),
      new ToolMessage({
        tool_call_id: "a",
        content: JSON.stringify({
          ok: true,
          rows: [{}],
          total: 1,
          truncated: false,
        }),
      }),
      new ToolMessage({
        tool_call_id: "b",
        content: JSON.stringify({
          ok: false,
          error: { code: "DATABASE_ERROR", message: "x" },
        }),
      }),
      new AIMessage("done"),
    ];
    expect(summarizeToolCalls(messages)).toEqual([
      { name: "query_customers", args: { name: "Ann" }, ok: true, total: 1 },
      {
        name: "query_orders",
        args: { customer_id: 3 },
        ok: false,
        total: null,
      },
    ]);
  });

  it("marks a call without a readable result as failed", () => {
    const messages = [
      new AIMessage({
        content: "",
        tool_calls: [
          { id: "a", name: "query_products", args: {} },
          { id: "b", name: "query_products", args: {} },
        ],
      }),
      new ToolMessage({ tool_call_id: "a", content: "not json" }),
    ];
    expect(summarizeToolCalls(messages)).toEqual([
      { name: "query_products", args: {}, ok: false, total: null },
      { name: "query_products", args: {}, ok: false, total: null },
    ]);
  });

  it("returns an empty list when no tool was called", () => {
    expect(summarizeToolCalls([new AIMessage("hello")])).toEqual([]);
  });
});
