import { MemorySaver } from "@langchain/langgraph";
import { tool } from "langchain";
import pino from "pino";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { buildAgent } from "../agent/build-agent.js";
import { CAFE_PROBLEM } from "../agent/cafe-script.js";
import { ScriptedChatModel } from "../agent/scripted-model.js";
import { createApp } from "./create-app.js";

const logger = pino({ level: "silent" });
const threadId = "5d1c3b0e-3f7a-4c1e-8f7d-3a2b1c0d9e8f";

function makeApp() {
  const executor = tool(
    async () =>
      JSON.stringify({
        status: "succeeded",
        exitCode: 0,
        stdout: "",
        stderr: "",
        result: {
          solution: { coffee: 3, tea: 2, sandwich: 5 },
          maxResidual: 0,
        },
        resultError: null,
        durationMs: 1,
        truncated: false,
      }),
    {
      name: "code_executor",
      description: "Runs Python.",
      schema: z.object({ code: z.string() }),
    },
  );
  const agent = buildAgent({
    model: new ScriptedChatModel({}),
    tools: [executor],
    checkpointer: new MemorySaver(),
    logger,
    now: () => new Date("2026-09-14"),
  });
  return createApp({ agent, tools: [executor], llmMode: "scripted", logger });
}

const chatBody = (text: string) => ({
  threadId,
  messages: [{ id: "u1", role: "user", parts: [{ type: "text", text }] }],
});

describe("HTTP app", () => {
  it("streams a chat turn as a UI message stream", async () => {
    const app = makeApp();
    const response = await app.request("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(chatBody(CAFE_PROBLEM)),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const body = await response.text();
    expect(body).toContain('"type":"tool-input-available"');
    expect(body).toContain('"toolName":"code_executor"');
    expect(body).toContain('"type":"tool-output-available"');
    expect(body).toContain("### Verification");
  });

  it("returns the stored thread history and an empty list for a new thread", async () => {
    const app = makeApp();
    await (
      await app.request("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(chatBody(CAFE_PROBLEM)),
      })
    ).text();
    const history = await (
      await app.request(`/api/threads/${threadId}/messages`)
    ).json();
    expect(history.threadId).toBe(threadId);
    expect(history.messages.map((m: { role: string }) => m.role)).toEqual([
      "user",
      "assistant",
    ]);
    const empty = await (
      await app.request(
        "/api/threads/0e0e0e0e-0000-4000-8000-000000000000/messages",
      )
    ).json();
    expect(empty.messages).toEqual([]);
  });

  it("rejects bad input with 400", async () => {
    const app = makeApp();
    expect(
      (await app.request("/api/chat", { method: "POST", body: "nope" })).status,
    ).toBe(400);
    expect((await app.request("/api/threads/not-a-uuid/messages")).status).toBe(
      400,
    );
  });

  it("describes the tools and mode", async () => {
    const body = await (await makeApp().request("/api/tools")).json();
    expect(body).toEqual({
      llmMode: "scripted",
      tools: [{ name: "code_executor", description: "Runs Python." }],
    });
  });
});
