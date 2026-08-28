import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../config.js";
import { createLogger } from "../logger.js";
import { createProcessHandler } from "./process.js";

const logger = createLogger({ appName: "test" });

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
  chatOutput: string,
  execFn: (cmd: string) => Promise<{ stdout: string; stderr: string }>,
) {
  const app = express();
  app.use(express.json());
  const chatFn = vi.fn(async () => chatOutput);
  app.post(
    "/process",
    createProcessHandler({
      config: baseConfig(variant),
      logger,
      chatFn,
      execFn,
    }),
  );
  return app;
}

describe("POST /process", () => {
  it("vulnerable: executes the model-generated command (RCE sink fires)", async () => {
    const execFn = vi.fn(async () => ({ stdout: "pwned\n", stderr: "" }));
    const app = buildApp("vulnerable", "id; echo pwned", execFn);

    const res = await request(app)
      .post("/process")
      .send({ instruction: "process it", data: "some data" });

    expect(res.status).toBe(200);
    expect(execFn).toHaveBeenCalledWith("id; echo pwned");
    expect(res.body.result).toBe("pwned\n");
  });

  it("hardened: classifies via parsed JSON and never executes anything", async () => {
    const execFn = vi.fn(async () => ({ stdout: "", stderr: "" }));
    const app = buildApp("hardened", '{"category":"invoice"}', execFn);

    const res = await request(app)
      .post("/process")
      .send({ instruction: "classify it", data: "some data" });

    expect(res.status).toBe(200);
    expect(res.body.result).toBe("classified as invoice");
    expect(execFn).not.toHaveBeenCalled();
  });
});
