import { describe, expect, it } from "vitest";
import { parseChatRequest } from "./chat-request.js";

const threadId = "0b6f1f5e-6a5f-4a39-9d9e-2f4f8f0a6c11";

describe("parseChatRequest", () => {
  it("takes the thread id and the text of the latest user message", () => {
    const result = parseChatRequest({
      id: "ignored",
      threadId,
      trigger: "submit-message",
      messages: [
        { id: "1", role: "user", parts: [{ type: "text", text: "old" }] },
        {
          id: "2",
          role: "assistant",
          parts: [{ type: "text", text: "answer" }],
        },
        {
          id: "3",
          role: "user",
          parts: [
            { type: "text", text: "new " },
            { type: "text", text: "question" },
          ],
        },
      ],
    });
    expect(result).toEqual({
      ok: true,
      value: { threadId, text: "new question" },
    });
  });

  it.each([
    [null],
    [{}],
    [
      {
        threadId: "not-a-uuid",
        messages: [{ role: "user", parts: [{ type: "text", text: "q" }] }],
      },
    ],
    [{ threadId, messages: [] }],
    [
      {
        threadId,
        messages: [{ role: "assistant", parts: [{ type: "text", text: "a" }] }],
      },
    ],
    [
      {
        threadId,
        messages: [{ role: "user", parts: [{ type: "text", text: "   " }] }],
      },
    ],
  ])("rejects %o", (body) => {
    expect(parseChatRequest(body).ok).toBe(false);
  });
});
