// src/config.test.ts
import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

describe("loadConfig", () => {
  it("applies defaults when env is empty", () => {
    const config = loadConfig({});
    expect(config).toEqual({
      ollamaBaseUrl: "http://localhost:11434",
      ollamaModel: "qwen3:4b",
      ollamaNumCtx: 16384,
      tavilyApiKey: undefined,
      searchMaxResults: 5,
      maxAgentSteps: 60,
      researchDir: "research",
    });
  });

  it("reads overrides from env", () => {
    const config = loadConfig({
      OLLAMA_BASE_URL: "http://other:11434",
      OLLAMA_MODEL: "qwen3:8b",
      OLLAMA_NUM_CTX: "8192",
      TAVILY_API_KEY: "tvly-x",
      SEARCH_MAX_RESULTS: "3",
      MAX_AGENT_STEPS: "40",
      RESEARCH_DIR: "out",
    });
    expect(config.ollamaModel).toBe("qwen3:8b");
    expect(config.ollamaNumCtx).toBe(8192);
    expect(config.tavilyApiKey).toBe("tvly-x");
    expect(config.searchMaxResults).toBe(3);
    expect(config.maxAgentSteps).toBe(40);
    expect(config.researchDir).toBe("out");
  });

  it("rejects a non-numeric numeric override", () => {
    expect(() => loadConfig({ OLLAMA_NUM_CTX: "lots" })).toThrow(
      /OLLAMA_NUM_CTX/,
    );
  });
});
