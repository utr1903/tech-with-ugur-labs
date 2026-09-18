import type {
  AIMessage,
  BaseMessage,
  ToolMessage,
} from "@langchain/core/messages";
import type { UIMessage } from "ai";

type UIPart = UIMessage["parts"][number];

// Rebuilds the UI conversation from checkpointed LangGraph messages in the
// same shape the live UI message stream produces: one user message per
// question, one assistant message per turn holding its tool calls (as
// dynamic-tool parts) and texts in order.
export function toUIMessages(messages: readonly BaseMessage[]): UIMessage[] {
  const result: UIMessage[] = [];
  let assistant: UIMessage | undefined;
  for (const message of messages) {
    const type = message.getType();
    if (type === "human") {
      assistant = undefined;
      result.push({
        id: messageId(message, result.length),
        role: "user",
        parts: [{ type: "text", text: textOf(message) }],
      });
    } else if (type === "ai") {
      if (!assistant) {
        assistant = {
          id: messageId(message, result.length),
          role: "assistant",
          parts: [],
        };
        result.push(assistant);
      }
      appendAiParts(assistant.parts, message as AIMessage);
    } else if (type === "tool" && assistant) {
      attachToolOutput(assistant.parts, message as ToolMessage);
    }
  }
  return result;
}

function messageId(message: BaseMessage, index: number): string {
  return message.id ?? `message-${index}`;
}

function textOf(message: BaseMessage): string {
  if (typeof message.content === "string") return message.content;
  return message.content
    .map((block) =>
      block.type === "text" && typeof block.text === "string" ? block.text : "",
    )
    .join("");
}

function appendAiParts(parts: UIPart[], message: AIMessage): void {
  for (const call of message.tool_calls ?? []) {
    parts.push({
      type: "dynamic-tool",
      toolName: call.name,
      toolCallId: call.id ?? "",
      state: "input-available",
      input: call.args,
    });
  }
  const text = textOf(message);
  if (text.length > 0) parts.push({ type: "text", text, state: "done" });
}

function attachToolOutput(parts: UIPart[], message: ToolMessage): void {
  const index = parts.findIndex(
    (p) => p.type === "dynamic-tool" && p.toolCallId === message.tool_call_id,
  );
  const part = parts[index];
  if (part?.type !== "dynamic-tool") return;
  parts[index] = {
    type: "dynamic-tool",
    toolName: part.toolName,
    toolCallId: part.toolCallId,
    state: "output-available",
    input: part.input,
    output: message.content,
  };
}
