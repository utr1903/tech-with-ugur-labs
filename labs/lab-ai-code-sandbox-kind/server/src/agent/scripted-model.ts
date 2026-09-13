import { randomUUID } from "node:crypto";
import type { CallbackManagerForLLMRun } from "@langchain/core/callbacks/manager";
import {
  BaseChatModel,
  type BindToolsInput,
} from "@langchain/core/language_models/chat_models";
import {
  AIMessage,
  AIMessageChunk,
  type BaseMessage,
} from "@langchain/core/messages";
import { ChatGenerationChunk, type ChatResult } from "@langchain/core/outputs";
import { CAFE_SOLVER_CODE, renderCafeAnswer } from "./cafe-script.js";

const TEXT_CHUNK_CHARS = 40;

// Decides the next assistant message for the keyless demo. Turn 1 of every
// question calls code_executor with the café solver; turn 2 writes the answer
// from the ToolMessage it actually received, so a broken tool path shows up
// in the answer instead of being papered over.
export function planNextMessage(messages: BaseMessage[]): AIMessage {
  const lastHuman = messages.findLastIndex((m) => m.getType() === "human");
  const toolMessage = messages
    .slice(lastHuman + 1)
    .find((m) => m.getType() === "tool");
  if (!toolMessage) {
    return new AIMessage({
      id: randomUUID(),
      content: "",
      tool_calls: [
        {
          id: `call_${randomUUID()}`,
          name: "code_executor",
          args: { code: CAFE_SOLVER_CODE },
          type: "tool_call",
        },
      ],
    });
  }
  return new AIMessage({
    id: randomUUID(),
    content: renderCafeAnswer(String(toolMessage.content)),
  });
}

export class ScriptedChatModel extends BaseChatModel {
  _llmType(): string {
    return "scripted";
  }

  // The script ignores tool schemas; binding returns the same model.
  override bindTools(_tools: BindToolsInput[]): this {
    return this;
  }

  async _generate(messages: BaseMessage[]): Promise<ChatResult> {
    const message = planNextMessage(messages);
    return { generations: [{ message, text: String(message.content) }] };
  }

  override async *_streamResponseChunks(
    messages: BaseMessage[],
    _options: this["ParsedCallOptions"],
    runManager?: CallbackManagerForLLMRun,
  ): AsyncGenerator<ChatGenerationChunk> {
    const planned = planNextMessage(messages);
    for (const chunk of toChunks(planned)) {
      const generation = new ChatGenerationChunk({
        message: chunk,
        text: String(chunk.content),
      });
      yield generation;
      await runManager?.handleLLMNewToken(
        String(chunk.content),
        undefined,
        undefined,
        undefined,
        undefined,
        { chunk: generation },
      );
    }
  }
}

function toChunks(message: AIMessage): AIMessageChunk[] {
  const id = message.id;
  const toolCall = message.tool_calls?.[0];
  if (toolCall) {
    return [
      new AIMessageChunk({
        id,
        content: "",
        tool_call_chunks: [
          {
            id: toolCall.id,
            name: toolCall.name,
            args: JSON.stringify(toolCall.args),
            index: 0,
            type: "tool_call_chunk",
          },
        ],
      }),
    ];
  }
  const text = String(message.content);
  const chunks: AIMessageChunk[] = [];
  for (let start = 0; start < text.length; start += TEXT_CHUNK_CHARS) {
    chunks.push(
      new AIMessageChunk({
        id,
        content: text.slice(start, start + TEXT_CHUNK_CHARS),
      }),
    );
  }
  return chunks;
}
