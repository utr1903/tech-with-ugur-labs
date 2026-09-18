import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

const base = { DATABASE_URL: "postgres://u:p@localhost:5432/chat" };

describe("loadConfig", () => {
  it("applies documented defaults", () => {
    expect(loadConfig(base)).toEqual({
      port: 8080,
      databaseUrl: base.DATABASE_URL,
      sandboxUrl: "http://sandbox:8000",
      sandboxClientTimeoutMs: 45_000,
      llmMode: "scripted",
      anthropicApiKey: undefined,
      anthropicModel: "claude-sonnet-5",
    });
  });

  it("requires DATABASE_URL", () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
  });

  it("requires an API key in live mode and treats an empty key as missing", () => {
    expect(() =>
      loadConfig({ ...base, LLM_MODE: "live", ANTHROPIC_API_KEY: "" }),
    ).toThrow(/ANTHROPIC_API_KEY/);
    expect(
      loadConfig({ ...base, LLM_MODE: "live", ANTHROPIC_API_KEY: "k" }).llmMode,
    ).toBe("live");
  });

  it("rejects an unknown mode", () => {
    expect(() => loadConfig({ ...base, LLM_MODE: "random" })).toThrow(
      /LLM_MODE/,
    );
  });
});
