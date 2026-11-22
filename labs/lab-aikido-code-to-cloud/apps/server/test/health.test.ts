import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { loadConfig } from "../src/config";

vi.spyOn(process.stdout, "write").mockImplementation(() => true);
const app = createApp({ config: loadConfig({ DATA_BUCKET: "b" }) });

describe("app", () => {
  it("GET /healthz", async () => {
    const res = await request(app).get("/healthz");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });
  it("GET / serves the chat UI", async () => {
    const res = await request(app).get("/");
    expect(res.status).toBe(200);
    expect(res.type).toBe("text/html");
    expect(res.text).toContain("PayBuddy");
    expect(res.text).toContain('id="login-form"');
    expect(res.text).toContain('id="chat-form"');
  });
  it("GET /app.js serves the UI script", async () => {
    const res = await request(app).get("/app.js");
    expect(res.status).toBe(200);
    expect(res.type).toBe("application/javascript");
  });
  it("malformed JSON yields 400 with a stack field", async () => {
    const res = await request(app)
      .post("/api/login")
      .set("Content-Type", "application/json")
      .send("{");
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("stack");
  });
});
