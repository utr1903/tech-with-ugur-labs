import { isToolMessage, ToolMessage } from "@langchain/core/messages";
import { createMiddleware } from "langchain";

// deepagents' read_file tool returns text files as content blocks
// (`[{ type: "text", text }]`) rather than a plain string, but
// @langchain/ollama's message converter only accepts string content on
// ToolMessage and throws otherwise. Flatten any non-string tool content
// to text before it reaches the model.
export function createStringifyToolContentMiddleware() {
  return createMiddleware({
    name: "StringifyToolContentMiddleware",
    wrapModelCall: (request, handler) =>
      handler({
        ...request,
        messages: request.messages.map((message) => {
          if (!isToolMessage(message) || typeof message.content === "string") {
            return message;
          }
          return new ToolMessage({ ...message, content: message.text });
        }),
      }),
  });
}
