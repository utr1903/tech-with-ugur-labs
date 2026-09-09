import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { requireAuth } from "../auth/middleware.js";
import { signSession } from "../auth/tokens.js";
import { loadConfig } from "../config.js";
import { createLogger } from "../logger.js";
import { CallBudget } from "./budget.js";
import { agentRoutes } from "./routes.js";

const secret = "not-a-real-secret-only-for-tests";
const logger = createLogger({ appName: "test" });

const body = {
  model: "client-chosen-model",
  messages: [
    { role: "system", content: "system" },
    { role: "user", content: "Current Page: [x](http://localhost:5173/sites)" },
  ],
};

async function harness(
  overrides: Record<string, string> = {},
  budget?: CallBudget,
) {
  const config = loadConfig({ JWT_SECRET: secret, ...overrides });
  const transport = vi.fn(async (request) => ({ echoed: request }));
  const app = new Hono();
  app.use("/api/agent/v1/*", requireAuth(secret));
  app.route(
    "/api/agent/v1",
    agentRoutes(config, logger, budget ?? new CallBudget(30, 300), transport),
  );
  const token = await signSession(
    { id: "u-rosa", name: "Rosa Iglesias" },
    secret,
  );
  return { app, transport, auth: { Authorization: `Bearer ${token}` } };
}

function post(auth: Record<string, string>, payload: unknown) {
  return {
    method: "POST",
    headers: { ...auth, "content-type": "application/json" },
    body: JSON.stringify(payload),
  };
}

describe("POST /api/agent/v1/chat/completions", () => {
  it("rejects an unauthenticated call", async () => {
    const { app } = await harness();
    const res = await app.request(
      "/api/agent/v1/chat/completions",
      post({}, body),
    );
    expect(res.status).toBe(401);
  });

  it("never forwards the client's model", async () => {
    const { app, transport, auth } = await harness({
      GEMINI_MODEL: "gemini-3.8-flash",
    });
    await app.request("/api/agent/v1/chat/completions", post(auth, body));
    expect(transport.mock.calls[0]?.[0].model).toBe("gemini-3.8-flash");
  });

  it("never forwards the caller's Authorization header", async () => {
    const { app, transport, auth } = await harness();
    await app.request("/api/agent/v1/chat/completions", post(auth, body));
    expect(JSON.stringify(transport.mock.calls[0]?.[0])).not.toContain(
      "Bearer",
    );
  });

  it("429s once the budget is spent", async () => {
    const { app, auth } = await harness({}, new CallBudget(1, 300));
    await app.request("/api/agent/v1/chat/completions", post(auth, body));
    const res = await app.request(
      "/api/agent/v1/chat/completions",
      post(auth, body),
    );
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBeTruthy();
  });

  it("400s a body that is not a chat completion", async () => {
    const { app, auth } = await harness();
    const res = await app.request(
      "/api/agent/v1/chat/completions",
      post(auth, { messages: "nope" }),
    );
    expect(res.status).toBe(400);
  });
});
