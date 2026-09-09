import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

describe("loadConfig", () => {
  it("defaults to the keyless scripted mode", () => {
    const config = loadConfig({});
    expect(config.llmMode).toBe("scripted");
    expect(config.port).toBe(8080);
    expect(config.agentCallBudget).toBe(120);
    expect(config.agentBudgetWindowS).toBe(300);
  });

  it("reads gemini mode and its model from the environment", () => {
    const config = loadConfig({
      LLM_MODE: "gemini",
      GEMINI_API_KEY: "test-key",
      GEMINI_MODEL: "gemini-2.5-flash",
    });
    expect(config.llmMode).toBe("gemini");
    expect(config.geminiModel).toBe("gemini-2.5-flash");
  });

  it("rejects gemini mode with an empty key", () => {
    expect(() =>
      loadConfig({ LLM_MODE: "gemini", GEMINI_API_KEY: "" }),
    ).toThrow(/GEMINI_API_KEY/);
  });

  it("rejects gemini mode with no key at all", () => {
    expect(() => loadConfig({ LLM_MODE: "gemini" })).toThrow(/GEMINI_API_KEY/);
  });

  it("rejects an unknown mode", () => {
    expect(() => loadConfig({ LLM_MODE: "openai" })).toThrow(/LLM_MODE/);
  });
});
