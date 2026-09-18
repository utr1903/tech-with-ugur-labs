import { toUIMessageStream } from "@ai-sdk/langchain";
import { HumanMessage } from "@langchain/core/messages";
import { MemorySaver } from "@langchain/langgraph";
import { readUIMessageStream, type UIMessage } from "ai";
import { createAgent, tool } from "langchain";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { CAFE_PROBLEM } from "../agent/cafe-script.js";
import { ScriptedChatModel } from "../agent/scripted-model.js";
import { toUIMessages } from "./history-mapper.js";

const stubExecutor = tool(
  async () =>
    JSON.stringify({
      status: "succeeded",
      exitCode: 0,
      stdout: "solution\n",
      stderr: "",
      result: { solution: { coffee: 3, tea: 2, sandwich: 5 }, maxResidual: 0 },
      resultError: null,
      durationMs: 5,
      truncated: false,
    }),
  {
    name: "code_executor",
    description: "stub",
    schema: z.object({ code: z.string() }),
  },
);

function makeAgent() {
  return createAgent({
    model: new ScriptedChatModel({}),
    tools: [stubExecutor],
    checkpointer: new MemorySaver(),
  });
}

async function streamTurn(
  agent: ReturnType<typeof makeAgent>,
  threadId: string,
  text: string,
): Promise<UIMessage> {
  const stream = await agent.stream(
    { messages: [new HumanMessage(text)] },
    {
      configurable: { thread_id: threadId },
      streamMode: ["values", "messages"],
    },
  );
  let last: UIMessage | undefined;
  for await (const message of readUIMessageStream({
    stream: toUIMessageStream(stream),
  }))
    last = message;
  if (!last) throw new Error("the stream produced no assistant message");
  return last;
}

// Compare what matters to the UI; ids, provider metadata and step markers are ignored.
function normalize(message: UIMessage) {
  return message.parts
    .filter((p) => p.type === "text" || p.type === "dynamic-tool")
    .map((p) =>
      p.type === "text"
        ? { type: p.type, text: p.text }
        : {
            type: p.type,
            toolName: p.toolName,
            toolCallId: p.toolCallId,
            state: p.state,
            input: p.input,
            output: "output" in p ? p.output : undefined,
          },
    );
}

async function history(
  agent: ReturnType<typeof makeAgent>,
  threadId: string,
): Promise<UIMessage[]> {
  const state = await agent.graph.getState({
    configurable: { thread_id: threadId },
  });
  return toUIMessages(state.values.messages ?? []);
}

describe("stream and checkpoint history agree", () => {
  it("rebuilds exactly the assistant message the stream showed", async () => {
    const agent = makeAgent();
    const streamed = await streamTurn(agent, "thread-1", CAFE_PROBLEM);
    const rebuilt = await history(agent, "thread-1");
    expect(rebuilt.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(
      normalize(streamed).some(
        (p) => p.type === "dynamic-tool" && p.state === "output-available",
      ),
    ).toBe(true);
    expect(normalize(rebuilt[1] as UIMessage)).toEqual(normalize(streamed));
  });

  it("streams only the new turn when the thread already has history", async () => {
    const agent = makeAgent();
    await streamTurn(agent, "thread-2", CAFE_PROBLEM);
    const second = await streamTurn(agent, "thread-2", "and again?");
    expect(
      normalize(second).filter((p) => p.type === "dynamic-tool"),
    ).toHaveLength(1);
    const rebuilt = await history(agent, "thread-2");
    expect(rebuilt.map((m) => m.role)).toEqual([
      "user",
      "assistant",
      "user",
      "assistant",
    ]);
    expect(normalize(rebuilt[3] as UIMessage)).toEqual(normalize(second));
  });
});
