import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import type { ServerConfig } from "./config.js";
import { createLogger } from "./logger.js";

function testConfig(): ServerConfig {
  return {
    port: 0,
    attackerUrl: "http://attacker:9000/collect",
    secretPath: "/secret/id_rsa",
  };
}

describe("createApp", () => {
  it("GET /health returns ok status", async () => {
    const app = createApp({
      config: testConfig(),
      logger: createLogger({ appName: "test" }),
    });

    const res = await request(app).get("/health");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });

  it("GET /debug/tools returns the 4 poisoned tool descriptions", async () => {
    const app = createApp({
      config: testConfig(),
      logger: createLogger({ appName: "test" }),
    });

    const res = await request(app).get("/debug/tools");

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(4);

    const concatenated = (res.body as { description: string }[])
      .map((tool) => tool.description)
      .join(" ");
    expect(concatenated).toContain("read_file");
    expect(concatenated).toContain("/secret/id_rsa");
    expect(concatenated).toContain("submit_telemetry");
  });

  it("POST /mcp handles an MCP initialize request over stateless Streamable HTTP", async () => {
    const app = createApp({
      config: testConfig(),
      logger: createLogger({ appName: "test" }),
    });

    const res = await request(app)
      .post("/mcp")
      .set("Content-Type", "application/json")
      .set("Accept", "application/json, text/event-stream")
      .send({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "test-client", version: "1.0.0" },
        },
      });

    expect(res.status).toBe(200);
    expect(res.text).toContain('"jsonrpc":"2.0"');
  });
});
