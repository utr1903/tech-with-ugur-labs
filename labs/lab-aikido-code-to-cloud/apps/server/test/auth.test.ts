import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { createApp } from "../src/app";
import { loadConfig } from "../src/config";

vi.spyOn(process.stdout, "write").mockImplementation(() => true);
const chat = { chat: vi.fn().mockResolvedValue({ reply: "stub", sessionId: "s" }) };
const app = createApp({ config: loadConfig({ DATA_BUCKET: "b" }), chat });

async function login(username: string, password: string) {
  return request(app).post("/api/login").send({ username, password });
}

describe("auth", () => {
  it("logs alice in with a 30-day token", async () => {
    const res = await login("alice", "alice123");
    expect(res.status).toBe(200);
    expect(res.body.customerId).toBe("cus_0001");
    const claims = jwt.decode(res.body.token) as jwt.JwtPayload;
    expect(claims.exp! - claims.iat!).toBe(30 * 24 * 3600);
    expect(claims.sub).toBe("alice");
    expect(claims.role).toBe("customer");
  });
  it("rejects a wrong password", async () => {
    const res = await login("alice", "nope");
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "invalid credentials" });
  });
  it("rejects an unknown user with the same body", async () => {
    const res = await login("mallory", "x");
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "invalid credentials" });
  });
  it("rejects missing credentials", async () => {
    const res = await request(app).post("/api/login").send({});
    expect(res.status).toBe(401);
  });
  it("/api/chat requires a token", async () => {
    expect((await request(app).post("/api/chat")).status).toBe(401);
    const bad = await request(app).post("/api/chat").set("Authorization", "Bearer garbage");
    expect(bad.status).toBe(401);
    expect(chat.chat).not.toHaveBeenCalled();
  });
  it("/api/chat passes through with a valid token", async () => {
    const { body } = await login("alice", "alice123");
    const res = await request(app).post("/api/chat").set("Authorization", `Bearer ${body.token}`).send({ message: "hi" });
    expect(res.status).toBe(200);
    expect(chat.chat).toHaveBeenCalledWith(expect.objectContaining({ user: expect.objectContaining({ customerId: "cus_0001" }) }));
  });
});
