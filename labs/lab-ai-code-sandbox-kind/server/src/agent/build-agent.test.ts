import type { CallbackManagerForLLMRun } from "@langchain/core/callbacks/manager";
import {
  BaseChatModel,
  type BindToolsInput,
} from "@langchain/core/language_models/chat_models";
import {
  AIMessage,
  type BaseMessage,
  HumanMessage,
  type ToolMessage,
} from "@langchain/core/messages";
import type { ChatGenerationChunk, ChatResult } from "@langchain/core/outputs";
import { MemorySaver } from "@langchain/langgraph";
import { tool } from "langchain";
import pino from "pino";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { buildAgent } from "./build-agent.js";
import { CAFE_PROBLEM } from "./cafe-script.js";
import { ScriptedChatModel } from "./scripted-model.js";

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

// Enforces the rule providers such as Anthropic apply: every tool call in an
// AI message must be answered by tool messages that come right after it.
function expectToolCallsAnsweredInPlace(messages: BaseMessage[]): void {
  messages.forEach((message, index) => {
    if (message.getType() !== "ai") return;
    const answered = new Set<string>();
    for (const next of messages.slice(index + 1)) {
      if (next.getType() !== "tool") break;
      answered.add((next as ToolMessage).tool_call_id);
    }
    for (const call of (message as AIMessage).tool_calls ?? []) {
      if (!call.id || !answered.has(call.id))
        throw new Error(`tool call ${call.id} is not answered right after it`);
    }
  });
}

// The scripted café model, but it refuses a request with an unanswered tool
// call and keeps every request it accepted.
class ToolPairingChatModel extends ScriptedChatModel {
  requests: BaseMessage[][] = [];

  override async _generate(messages: BaseMessage[]): Promise<ChatResult> {
    expectToolCallsAnsweredInPlace(messages);
    this.requests.push(messages);
    return super._generate(messages);
  }

  override async *_streamResponseChunks(
    messages: BaseMessage[],
    options: this["ParsedCallOptions"],
    runManager?: CallbackManagerForLLMRun,
  ): AsyncGenerator<ChatGenerationChunk> {
    expectToolCallsAnsweredInPlace(messages);
    this.requests.push(messages);
    yield* super._streamResponseChunks(messages, options, runManager);
  }
}

// The first call hangs until the run is aborted, like a reload during a long
// sandbox run; later calls answer straight away.
function hangingOnceExecutor() {
  let calls = 0;
  let markStarted = () => {};
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const executor = tool(
    async (_input, config) => {
      calls += 1;
      if (calls > 1)
        return JSON.stringify({
          status: "succeeded",
          result: {
            solution: { coffee: 3, tea: 2, sandwich: 5 },
            maxResidual: 0,
          },
        });
      markStarted();
      return new Promise<string>((_resolve, reject) => {
        config.signal?.addEventListener("abort", () =>
          reject(new Error("aborted")),
        );
      });
    },
    {
      name: "code_executor",
      description: "stub",
      schema: z.object({ code: z.string() }),
    },
  );
  return { executor, started };
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

  it("keeps a thread working after a turn is interrupted mid tool call", async () => {
    const model = new ToolPairingChatModel({});
    const { executor, started } = hangingOnceExecutor();
    const agent = buildAgent({
      model,
      tools: [executor],
      checkpointer: new MemorySaver(),
      logger: pino({ level: "silent" }),
      now: () => new Date("2026-09-14T12:00:00Z"),
    });
    const config = { configurable: { thread_id: "interrupted" } };

    const controller = new AbortController();
    const firstTurn = agent.invoke(
      { messages: [new HumanMessage(CAFE_PROBLEM)] },
      { ...config, signal: controller.signal },
    );
    await started;
    controller.abort();
    await expect(firstTurn).rejects.toThrow();

    const interrupted: BaseMessage[] = (await agent.graph.getState(config))
      .values.messages;
    expect(interrupted.map((m) => m.getType())).toEqual(["human", "ai"]);
    const lostCallId = (interrupted[1] as AIMessage).tool_calls?.[0]?.id;
    expect(lostCallId).toBeDefined();

    const secondTurn = await agent.invoke(
      { messages: [new HumanMessage("Can you try that again?")] },
      config,
    );
    expect(String(secondTurn.messages.at(-1)?.content)).toContain(
      "### Solution",
    );

    const secondRequest = model.requests[1] ?? [];
    const lostCallIndex = secondRequest.findIndex(
      (m) =>
        m.getType() === "ai" &&
        (m as AIMessage).tool_calls?.[0]?.id === lostCallId,
    );
    const synthetic = secondRequest[lostCallIndex + 1] as ToolMessage;
    expect(synthetic.tool_call_id).toBe(lostCallId);
    expect(JSON.parse(String(synthetic.content))).toMatchObject({
      error: "interrupted",
    });

    const stored: BaseMessage[] = (await agent.graph.getState(config)).values
      .messages;
    expect(
      stored.some(
        (m) =>
          m.getType() === "tool" &&
          (m as ToolMessage).tool_call_id === lostCallId,
      ),
    ).toBe(false);
  });
});
