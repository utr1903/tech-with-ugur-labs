import { describe, expect, it } from "vitest";
import { loadConfig } from "../config.js";
import { guardChatRequest } from "./guard.js";

const config = loadConfig({ GEMINI_MODEL: "gemini-3.8-flash" });

const valid = {
  model: "whatever-the-client-said",
  messages: [
    { role: "system", content: "you are an agent" },
    { role: "user", content: "file the report" },
  ],
  tools: [{ type: "function", function: { name: "AgentOutput" } }],
  tool_choice: { type: "function", function: { name: "AgentOutput" } },
  parallel_tool_calls: false,
};

describe("guardChatRequest", () => {
  it("pins the model regardless of what the client asked for", () => {
    const result = guardChatRequest(valid, config);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.request.model).toBe("gemini-3.8-flash");
  });

  it("pins max_tokens", () => {
    const result = guardChatRequest({ ...valid, max_tokens: 999_999 }, config);
    if (!result.ok) throw new Error("expected ok");
    expect(result.request.max_tokens).toBe(config.agentMaxTokens);
  });

  it("drops every field outside the allowlist", () => {
    const result = guardChatRequest(
      { ...valid, api_key: "sk-leak", stream: true, user: "someone-else" },
      config,
    );
    if (!result.ok) throw new Error("expected ok");
    expect(result.request).not.toHaveProperty("api_key");
    expect(result.request).not.toHaveProperty("stream");
    expect(result.request).not.toHaveProperty("user");
  });

  it("keeps the fields the agent legitimately needs", () => {
    const result = guardChatRequest(valid, config);
    if (!result.ok) throw new Error("expected ok");
    expect(result.request.messages).toHaveLength(2);
    expect(result.request.parallel_tool_calls).toBe(false);
    expect(result.request.tool_choice).toEqual(valid.tool_choice);
  });

  it("rejects a body that is not a chat completion", () => {
    expect(guardChatRequest({ messages: "nope" }, config)).toMatchObject({
      ok: false,
      status: 400,
    });
  });

  it("rejects too many messages", () => {
    const messages = Array.from(
      { length: config.agentMaxMessages + 1 },
      () => ({
        role: "user",
        content: "x",
      }),
    );
    expect(guardChatRequest({ ...valid, messages }, config)).toMatchObject({
      ok: false,
      status: 400,
    });
  });

  it("rejects an oversized body", () => {
    const huge = "x".repeat(config.agentMaxRequestBytes + 1);
    expect(
      guardChatRequest(
        { ...valid, messages: [{ role: "user", content: huge }] },
        config,
      ),
    ).toMatchObject({ ok: false, status: 413 });
  });

  it("counts tools toward the size cap, not just messages", () => {
    // A tiny message array must not be a way to smuggle a huge tool schema
    // through to the upstream model on our key.
    const huge = "x".repeat(config.agentMaxRequestBytes + 1);
    expect(
      guardChatRequest({ ...valid, tools: [{ description: huge }] }, config),
    ).toMatchObject({ ok: false, status: 413 });
  });

  it("forwards these keys and no others", () => {
    const result = guardChatRequest(
      { ...valid, api_key: "sk-leak", stream: true },
      config,
    );
    if (!result.ok) throw new Error("expected ok");
    // Exact equality, so a future field silently joining the passthrough fails.
    expect(Object.keys(result.request).sort()).toEqual([
      "max_tokens",
      "messages",
      "model",
      "parallel_tool_calls",
      "tool_choice",
      "tools",
    ]);
  });
});
