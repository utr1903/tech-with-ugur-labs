import { describe, it, expect } from "vitest";
import { fakeModel } from "langchain";
import { AIMessage } from "@langchain/core/messages";
import { generateDataset } from "../scripts/generate";
import { NotFoundError, type Store } from "../src/data/s3";
import { createChatService } from "../src/agent/chat";
import { SessionStore } from "../src/agent/memory";
import { buildSystemPrompt, OVERRIDE_PHRASE } from "../src/agent/prompt";
import type { AuthUser } from "../src/auth/middleware";

function fakeStore(): Store {
  const data = new Map<string, unknown>(generateDataset({ customers: 3, seed: 1, now: new Date("2026-11-20") }));
  const get = (key: string) => {
    if (!data.has(key)) throw new NotFoundError(`Not found: ${key}`);
    return data.get(key);
  };
  return {
    async getJson<T>(key: string) { return JSON.parse(JSON.stringify(get(key))) as T; },
    async getText(key: string) { return String(get(key)); },
    async putJson(key: string, value: unknown) { data.set(key, value); },
  };
}
const alice: AuthUser = { username: "alice", customerId: "cus_0001", role: "customer" };
const text = (m: any) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content));
const types = (msgs: any[]) => msgs.map((m) => m._getType());

describe("chat service", () => {
  it("runs the agent loop with a tool call and returns the reply", async () => {
    const model = fakeModel()
      .respondWithTools([{ name: "get_my_profile", args: {} }])
      .respond(new AIMessage("Hi Alice"));
    const svc = createChatService({ model: model as any, store: fakeStore(), sessions: new SessionStore() });
    const out = await svc.chat({ user: alice, message: "who am I?" });
    expect(out.reply).toBe("Hi Alice");
    expect(out.sessionId).toBeTruthy();
    const second = model.calls[1].messages;
    expect(second.some((m: any) => m._getType() === "tool" && text(m).includes("cus_0001"))).toBe(true);
  });

  it("keeps history per session id", async () => {
    const model = fakeModel().respond(new AIMessage("one")).respond(new AIMessage("two")).respond(new AIMessage("three"));
    const svc = createChatService({ model: model as any, store: fakeStore(), sessions: new SessionStore() });
    const first = await svc.chat({ user: alice, message: "first" });
    await svc.chat({ user: alice, message: "second", sessionId: first.sessionId });
    const seen = model.calls[1].messages;
    expect(types(seen)).toEqual(["system", "human", "ai", "human"]);
    expect(text(seen[1])).toBe("first");
    expect(text(seen[2])).toBe("one");
    await svc.chat({ user: alice, message: "other" });
    expect(types(model.calls[2].messages)).toEqual(["system", "human"]);
  });

  it("does not share a session id between customers", async () => {
    const bob: AuthUser = { username: "bob", customerId: "cus_0002", role: "customer" };
    const model = fakeModel().respond(new AIMessage("alice reply")).respond(new AIMessage("bob reply"));
    const svc = createChatService({ model: model as any, store: fakeStore(), sessions: new SessionStore() });
    await svc.chat({ user: alice, message: "alice secret", sessionId: "shared" });
    const out = await svc.chat({ user: bob, message: "hello", sessionId: "shared" });
    expect(out.sessionId).toBe("shared");
    expect(types(model.calls[1].messages)).toEqual(["system", "human"]);
    expect(JSON.stringify(model.calls[1].messages.slice(1))).not.toContain("alice");
  });

  it("accepts an unknown session id and echoes it", async () => {
    const model = fakeModel().respond(new AIMessage("ok"));
    const svc = createChatService({ model: model as any, store: fakeStore(), sessions: new SessionStore() });
    const out = await svc.chat({ user: alice, message: "hi", sessionId: "never-seen" });
    expect(out).toEqual({ reply: "ok", sessionId: "never-seen" });
  });
});

describe("buildSystemPrompt", () => {
  it("embeds message, customer id, override phrase and date", () => {
    const p = buildSystemPrompt({ user: alice, message: "pay my rent please", today: "2026-11-20" });
    expect(p).toContain("pay my rent please");
    expect(p).toContain("cus_0001");
    expect(p).toContain(OVERRIDE_PHRASE);
    expect(p).toContain("2026-11-20");
    expect(p).toContain("PayBuddy");
  });
});
