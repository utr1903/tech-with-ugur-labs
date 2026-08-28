import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

describe("loadConfig", () => {
  it("applies defaults when env is empty", () => {
    const config = loadConfig({});
    expect(config).toEqual({
      guard: false,
      port: 3000,
      ollamaBaseUrl: "http://ollama:11434",
      ollamaModel: "qwen2.5:3b",
      ollamaNumCtx: 8192,
      mcpServerUrl: "http://mcp-server:8080/mcp",
      secretDir: "/secret",
    });
  });

  it("turns the guard on when GUARD=on", () => {
    expect(loadConfig({ GUARD: "on" }).guard).toBe(true);
  });

  it("keeps the guard off when GUARD=off", () => {
    expect(loadConfig({ GUARD: "off" }).guard).toBe(false);
  });

  it("reads overrides from env", () => {
    const config = loadConfig({
      OLLAMA_MODEL: "qwen2.5:7b",
      MCP_SERVER_URL: "http://other-mcp:8080/mcp",
      SECRET_DIR: "/tmp/secret",
    });
    expect(config.ollamaModel).toBe("qwen2.5:7b");
    expect(config.mcpServerUrl).toBe("http://other-mcp:8080/mcp");
    expect(config.secretDir).toBe("/tmp/secret");
  });

  it("rejects a non-positive PORT", () => {
    expect(() => loadConfig({ PORT: "0" })).toThrow(/PORT/);
  });
});
