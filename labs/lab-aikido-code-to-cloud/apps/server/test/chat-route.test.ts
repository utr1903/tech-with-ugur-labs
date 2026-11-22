import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { loadConfig } from "../src/config";
import type { ChatService } from "../src/agent/chat";

vi.spyOn(process.stdout, "write").mockImplementation(() => true);

async function appWith(chat: ChatService) {
  const app = createApp({ config: loadConfig({ DATA_BUCKET: "b" }), chat });
  const { body } = await request(app).post("/api/login").send({ username: "alice", password: "alice123" });
  return { app, auth: `Bearer ${body.token}` };
}

describe("POST /api/chat", () => {
  it("returns reply and sessionId", async () => {
    const chat = { chat: vi.fn().mockResolvedValue({ reply: "hello", sessionId: "s1" }) };
    const { app, auth } = await appWith(chat);
    const res = await request(app).post("/api/chat").set("Authorization", auth).send({ message: "hi", sessionId: "s1" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ reply: "hello", sessionId: "s1" });
    expect(chat.chat).toHaveBeenCalledWith({ user: expect.objectContaining({ customerId: "cus_0001" }), message: "hi", sessionId: "s1" });
  });

  it("surfaces model errors as 502 and keeps serving", async () => {
    const chat = {
      chat: vi.fn().mockRejectedValueOnce(new Error("ThrottlingException")).mockResolvedValue({ reply: "ok", sessionId: "s" }),
    };
    const { app, auth } = await appWith(chat);
    const bad = await request(app).post("/api/chat").set("Authorization", auth).send({ message: "hi" });
    expect(bad.status).toBe(502);
    expect(bad.body.error).toBe("ThrottlingException");
    expect(bad.body.details).toContain("ThrottlingException");
    const good = await request(app).post("/api/chat").set("Authorization", auth).send({ message: "hi" });
    expect(good.status).toBe(200);
  });

  it("rejects a missing message", async () => {
    const { app, auth } = await appWith({ chat: vi.fn() });
    const res = await request(app).post("/api/chat").set("Authorization", auth).send({});
    expect(res.status).toBe(400);
  });
});
