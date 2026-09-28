import pino from "pino";
import { describe, expect, it, vi } from "vitest";
import type { AnswerQuestion } from "../agent/answer.js";
import { createApp } from "./app.js";

const logger = pino({ level: "silent" });

const answered: AnswerQuestion = async () => ({
  answer: "ann@example.com",
  toolCalls: [
    { name: "query_customers", args: { name: "Ann" }, ok: true, total: 1 },
  ],
});

function post(app: ReturnType<typeof createApp>, body: unknown, raw = false) {
  return app.request("/query", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: raw ? String(body) : JSON.stringify(body),
  });
}

describe("GET /readyz", () => {
  it("answers 200", async () => {
    const app = createApp({ answerQuestion: answered, logger });
    const response = await app.request("/readyz");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ready" });
  });
});

describe("POST /query", () => {
  it("returns the answer, the model, the tool calls and the duration", async () => {
    const answerQuestion = vi.fn(answered);
    const app = createApp({ answerQuestion, logger });
    const response = await post(app, {
      model: "kimi-k3",
      query: "Ann's email?",
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { durationMs: number };
    expect(body).toMatchObject({
      answer: "ann@example.com",
      model: "kimi-k3",
      toolCalls: [
        { name: "query_customers", args: { name: "Ann" }, ok: true, total: 1 },
      ],
    });
    expect(body.durationMs).toBeGreaterThanOrEqual(0);
    expect(answerQuestion.mock.calls[0]?.[0]).toMatchObject({
      entry: { key: "kimi-k3", bedrockId: "global.moonshotai.kimi-k3" },
      query: "Ann's email?",
    });
  });
});

describe("POST /query invalid model", () => {
  it("rejects an unknown model and lists the valid ones", async () => {
    const answerQuestion = vi.fn(answered);
    const app = createApp({ answerQuestion, logger });
    const response = await post(app, { model: "not-a-model", query: "hi" });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: "UNKNOWN_MODEL", message: 'Unknown model "not-a-model".' },
      validModels: [
        "minimax-m2.5",
        "nemotron-super-3",
        "deepseek-v3.2",
        "kimi-k3",
      ],
    });
    expect(answerQuestion).not.toHaveBeenCalled();
  });

  it.each([
    ["a missing query", { model: "kimi-k3" }],
    ["a missing model", { query: "hi" }],
    ["an empty query", { model: "kimi-k3", query: "" }],
    ["a whitespace-only query", { model: "kimi-k3", query: "   " }],
    ["a query of 501 characters", { model: "kimi-k3", query: "a".repeat(501) }],
    ["a query that is not text", { model: "kimi-k3", query: 42 }],
    ["a body that is a list", []],
  ])("rejects %s with 400", async (_name, body) => {
    const app = createApp({ answerQuestion: answered, logger });
    const response = await post(app, body);
    expect(response.status).toBe(400);
    const parsed = (await response.json()) as { error: { code: string } };
    expect(parsed.error.code).toBe("INVALID_REQUEST");
  });
});

describe("POST /query boundary and malformed bodies", () => {
  it("accepts a query of exactly 500 characters", async () => {
    const app = createApp({ answerQuestion: answered, logger });
    const response = await post(app, {
      model: "kimi-k3",
      query: "a".repeat(500),
    });
    expect(response.status).toBe(200);
  });

  it("rejects a body that is not JSON with 400", async () => {
    const app = createApp({ answerQuestion: answered, logger });
    const response = await post(app, "{not json", true);
    expect(response.status).toBe(400);
    const parsed = (await response.json()) as { error: { code: string } };
    expect(parsed.error.code).toBe("INVALID_REQUEST");
  });
});

describe("POST /query failure mapping", () => {
  it("answers 502 when the login session has expired, and keeps serving", async () => {
    const expired = Object.assign(
      new Error("cache /home/node/.aws/login/cache/x.json"),
      {
        name: "ExpiredTokenException",
      },
    );
    const lines: string[] = [];
    const capturing = pino(
      { level: "info" },
      { write: (line: string) => lines.push(line) },
    );
    const app = createApp({
      answerQuestion: async () => {
        throw expired;
      },
      logger: capturing,
    });
    const response = await post(app, { model: "kimi-k3", query: "hi" });
    expect(response.status).toBe(502);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("AWS_LOGIN_REQUIRED");
    expect(JSON.stringify(body)).not.toContain(".aws");
    expect(lines.join("")).not.toContain(".aws");
    expect((await app.request("/readyz")).status).toBe(200);
  });

  it("answers 504 when the agent reaches its step limit", async () => {
    const app = createApp({
      answerQuestion: async () => {
        throw Object.assign(new Error("limit"), {
          name: "GraphRecursionError",
        });
      },
      logger,
    });
    const response = await post(app, { model: "kimi-k3", query: "hi" });
    expect(response.status).toBe(504);
    const parsed = (await response.json()) as { error: { code: string } };
    expect(parsed.error.code).toBe("AGENT_LIMIT_REACHED");
  });
});

describe("unknown routes", () => {
  it("answers 404 in the standard error shape for unknown paths", async () => {
    const app = createApp({ answerQuestion: answered, logger });
    const response = await app.request("/nope");
    expect(response.status).toBe(404);
    const parsed = (await response.json()) as { error: { code: string } };
    expect(parsed.error.code).toBe("NOT_FOUND");
  });
});
