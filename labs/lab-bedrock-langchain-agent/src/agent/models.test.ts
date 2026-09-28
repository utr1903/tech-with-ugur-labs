import { describe, expect, it } from "vitest";
import { findModel, MODEL_KEYS, MODELS } from "./models.js";

describe("model registry", () => {
  it("offers exactly the four documented keys", () => {
    expect(MODEL_KEYS).toEqual([
      "minimax-m2.5",
      "nemotron-super-3",
      "deepseek-v3.2",
      "kimi-k3",
    ]);
  });

  it("uses a global inference profile for Kimi K3 and sends no temperature", () => {
    expect(MODELS["kimi-k3"].kind).toBe("global-inference-profile");
    expect(MODELS["kimi-k3"].bedrockId).toMatch(
      /^global\.[a-z]+\.[a-z0-9.-]+$/,
    );
    expect(MODELS["kimi-k3"].sendTemperature).toBe(false);
  });

  it("uses in-Region model ids for the other three models", () => {
    for (const key of [
      "minimax-m2.5",
      "nemotron-super-3",
      "deepseek-v3.2",
    ] as const) {
      expect(MODELS[key].sendTemperature).toBe(true);
      expect(MODELS[key].kind).toBe("in-region-model-id");
      expect(MODELS[key].bedrockId).toMatch(/^[a-z]+\.[a-z0-9.-]+$/);
      expect(MODELS[key].bedrockId).not.toMatch(/^(global|us|eu|apac)\./);
    }
  });

  it("finds a model by key and nothing for other input", () => {
    expect(findModel("kimi-k3")?.bedrockId).toBe("global.moonshotai.kimi-k3");
    expect(findModel("not-a-model")).toBeUndefined();
    expect(findModel("toString")).toBeUndefined();
    expect(findModel("")).toBeUndefined();
  });
});
