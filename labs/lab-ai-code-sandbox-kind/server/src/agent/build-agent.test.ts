import {
  BaseChatModel,
  type BindToolsInput,
} from "@langchain/core/language_models/chat_models";
import {
  AIMessage,
  type BaseMessage,
  HumanMessage,
} from "@langchain/core/messages";
import type { ChatResult } from "@langchain/core/outputs";
import { MemorySaver } from "@langchain/langgraph";
import pino from "pino";
import { describe, expect, it } from "vitest";
import { buildAgent } from "./build-agent.js";

// Records the system message text it was invoked with on every model turn,
// without inspecting or duplicating buildAgent's own logic.
class RecordingChatModel extends BaseChatModel {
  systemPrompts: string[] = [];

  _llmType(): string {
    return "recording";
  }

  // The script ignores tool schemas; binding returns the same model.
  override bindTools(_tools: BindToolsInput[]): this {
    return this;
  }

  async _generate(messages: BaseMessage[]): Promise<ChatResult> {
    const system = messages.find((m) => m.getType() === "system");
    this.systemPrompts.push(String(system?.content ?? ""));
    return { generations: [{ message: new AIMessage(""), text: "" }] };
  }
}

describe("buildAgent", () => {
  it("recomputes the system prompt's date on every model turn", async () => {
    const model = new RecordingChatModel({});
    let clock = new Date("2026-09-14T23:59:00Z");
    const agent = buildAgent({
      model,
      tools: [],
      checkpointer: new MemorySaver(),
      logger: pino({ level: "silent" }),
      now: () => clock,
    });

    await agent.invoke(
      { messages: [new HumanMessage("first question")] },
      { configurable: { thread_id: "turn-1" } },
    );
    clock = new Date("2026-09-15T00:05:00Z");
    await agent.invoke(
      { messages: [new HumanMessage("second question")] },
      { configurable: { thread_id: "turn-2" } },
    );

    expect(model.systemPrompts).toHaveLength(2);
    expect(model.systemPrompts[0]).toContain("Today's date is 2026-09-14.");
    expect(model.systemPrompts[1]).toContain("Today's date is 2026-09-15.");
  });
});
