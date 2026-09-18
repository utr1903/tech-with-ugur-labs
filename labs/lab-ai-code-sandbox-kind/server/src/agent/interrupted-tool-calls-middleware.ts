import {
  type AIMessage,
  type BaseMessage,
  ToolMessage,
} from "@langchain/core/messages";
import { createMiddleware } from "langchain";
import type { Logger } from "../logger.js";

// Same shape and serialisation as the code_executor tool's other structured
// errors, so the model reads it like any failed sandbox call.
const INTERRUPTED_CONTENT = JSON.stringify({
  error: "interrupted",
  message: "The previous run was interrupted before the sandbox answered.",
});

function isAnsweredLater(
  messages: readonly BaseMessage[],
  fromIndex: number,
  toolCallId: string,
): boolean {
  return messages
    .slice(fromIndex + 1)
    .some(
      (m) =>
        m.getType() === "tool" &&
        (m as ToolMessage).tool_call_id === toolCallId,
    );
}

// Returns the messages with a synthetic "interrupted" tool message inserted
// directly after every AI message whose tool call never got an answer. When
// every call is answered it returns the input array itself.
export function answerInterruptedToolCalls(
  messages: readonly BaseMessage[],
): readonly BaseMessage[] {
  const repaired: BaseMessage[] = [];
  let changed = false;
  messages.forEach((message, index) => {
    repaired.push(message);
    if (message.getType() !== "ai") return;
    for (const call of (message as AIMessage).tool_calls ?? []) {
      if (!call.id || isAnsweredLater(messages, index, call.id)) continue;
      repaired.push(
        new ToolMessage({
          content: INTERRUPTED_CONTENT,
          tool_call_id: call.id,
          name: call.name,
        }),
      );
      changed = true;
    }
  });
  return changed ? repaired : messages;
}

// A turn that is cut off while a tool runs (a reload, "New chat", a closed
// tab) aborts the graph after the model's tool call was checkpointed but
// before its tool message was. Providers such as Anthropic reject a request
// that contains an unanswered tool call, so every later turn on that thread
// would fail. This repairs only the request sent to the model; the stored
// history is left exactly as it was.
export function createInterruptedToolCallsMiddleware({
  logger,
}: {
  logger: Logger;
}) {
  return createMiddleware({
    name: "InterruptedToolCallsMiddleware",
    wrapModelCall: (request, handler) => {
      const messages = answerInterruptedToolCalls(request.messages);
      if (messages === request.messages) return handler(request);
      logger.warn(
        { answered: messages.length - request.messages.length },
        "Answering tool calls left unanswered by an interrupted turn.",
      );
      return handler({ ...request, messages: [...messages] });
    },
  });
}
