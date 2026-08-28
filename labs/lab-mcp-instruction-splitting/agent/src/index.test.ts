import type { ChatOllama } from "@langchain/ollama";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import type { AgentConfig } from "./config.js";
import { createLogger } from "./logger.js";

function silentLogger() {
  const logger = createLogger({ appName: "index-test" });
  logger.level = "silent";
  return logger;
}

function fakeConfig(): AgentConfig {
  return {
    guard: false,
    port: 3000,
    ollamaBaseUrl: "http://ollama:11434",
    ollamaModel: "qwen2.5:3b",
    ollamaNumCtx: 8192,
    mcpServerUrl: "http://mcp-server:8080/mcp",
    secretDir: "/secret",
  };
}

describe("createApp", () => {
  it("GET /health responds ok", async () => {
    // POST /run needs a live MCP server + model; it is exercised by the
    // compose e2e, not here.
    const app = createApp({
      config: fakeConfig(),
      logger: silentLogger(),
      model: {} as ChatOllama,
    });

    const response = await request(app).get("/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok" });
  });
});
