import { AIMessage, ToolMessage } from "@langchain/core/messages";
import { describe, expect, it } from "vitest";
import { createStringifyToolContentMiddleware } from "./stringify-tool-content-middleware.js";

describe("createStringifyToolContentMiddleware", () => {
  it("flattens array-of-blocks tool message content to a string", async () => {
    const middleware = createStringifyToolContentMiddleware();
    const request = {
      messages: [
        new ToolMessage({
          content: [{ type: "text", text: "file contents" }],
          tool_call_id: "call-1",
          name: "read_file",
        }),
      ],
    };
    let seenMessages: unknown[] = [];
    const handler = (modified: { messages: unknown[] }) => {
      seenMessages = modified.messages;
      return Promise.resolve({});
    };
    // Direct cast: exercising the hook with a minimal request shape
    await (
      middleware.wrapModelCall as (r: unknown, h: unknown) => Promise<unknown>
    )(request, handler);
    const message = (seenMessages as ToolMessage[])[0];
    expect(message).toBeDefined();
    expect(message?.content).toBe("file contents");
    expect(message?.tool_call_id).toBe("call-1");
  });

  it("leaves string tool message content and non-tool messages untouched", async () => {
    const middleware = createStringifyToolContentMiddleware();
    const stringToolMessage = new ToolMessage({
      content: "already a string",
      tool_call_id: "call-2",
    });
    const aiMessage = new AIMessage({ content: "hello" });
    const request = { messages: [stringToolMessage, aiMessage] };
    let seenMessages: unknown[] = [];
    const handler = (modified: { messages: unknown[] }) => {
      seenMessages = modified.messages;
      return Promise.resolve({});
    };
    // Direct cast: exercising the hook with a minimal request shape
    await (
      middleware.wrapModelCall as (r: unknown, h: unknown) => Promise<unknown>
    )(request, handler);
    expect(seenMessages[0]).toBe(stringToolMessage);
    expect(seenMessages[1]).toBe(aiMessage);
  });
});
