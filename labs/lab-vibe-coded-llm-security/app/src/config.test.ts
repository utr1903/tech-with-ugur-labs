import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

const base = {
  APP_VARIANT: "vulnerable",
  ASSISTANT_SECRET: "CANARY-EXFIL-a1b2c3d4",
};

describe("loadConfig", () => {
  it("defaults port, ollama url and model", () => {
    const c = loadConfig({ ...base });
    expect(c.port).toBe(3000);
    expect(c.ollamaBaseUrl).toBe("http://ollama:11434");
    expect(c.ollamaModel).toBe("qwen2.5:3b");
    expect(c.variant).toBe("vulnerable");
    expect(c.assistantSecret).toBe("CANARY-EXFIL-a1b2c3d4");
  });
  it("reads the hardened variant", () => {
    expect(loadConfig({ ...base, APP_VARIANT: "hardened" }).variant).toBe(
      "hardened",
    );
  });
  it("rejects an unknown variant", () => {
    expect(() => loadConfig({ ...base, APP_VARIANT: "nope" })).toThrow(
      /APP_VARIANT/,
    );
  });
  it("rejects a non-positive port", () => {
    expect(() => loadConfig({ ...base, PORT: "0" })).toThrow(/PORT/);
  });
});
