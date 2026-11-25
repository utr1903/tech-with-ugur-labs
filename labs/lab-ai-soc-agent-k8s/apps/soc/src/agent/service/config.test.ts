import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

const base = {
  AGENT_TOKEN: "a",
  RESPONDER_URL: "http://r",
  RESPONDER_TOKEN: "t",
  LOKI_URL: "http://l",
  REPORTS_DIR: "/reports",
  ANTHROPIC_API_KEY: "k",
};

describe("loadConfig", () => {
  it("applies defaults", () => {
    const c = loadConfig(base);
    expect(c.port).toBe(8080);
    expect(c.tokenBudget).toBe(400000);
    expect(c.maxIterations).toBe(25);
  });

  it("reads overrides", () => {
    const c = loadConfig({
      ...base,
      PORT: "9000",
      INVESTIGATION_TOKEN_BUDGET: "5",
      MAX_ITERATIONS: "3",
    });
    expect([c.port, c.tokenBudget, c.maxIterations]).toEqual([9000, 5, 3]);
  });

  it("names every missing variable without leaking values", () => {
    expect(() => loadConfig({ AGENT_TOKEN: "secret" })).toThrow(
      /RESPONDER_URL.*RESPONDER_TOKEN.*LOKI_URL.*REPORTS_DIR.*ANTHROPIC_API_KEY/,
    );
    expect(() => loadConfig({ AGENT_TOKEN: "secret" })).not.toThrow(/secret/);
  });

  it("rejects non-numeric numbers", () => {
    expect(() => loadConfig({ ...base, PORT: "abc" })).toThrow("PORT");
  });
});
