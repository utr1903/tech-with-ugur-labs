import { describe, expect, it } from "vitest";
import { loadConfig } from "../config.js";
import { buildChatModel } from "./model.js";

describe("buildChatModel", () => {
  it("configures Ollama for reliable small-model tool calling", () => {
    const model = buildChatModel(loadConfig({}));
    expect(model.model).toBe("qwen3:4b");
    expect(model.temperature).toBe(0);
    expect(model.numCtx).toBe(16384);
    expect(model.think).toBe(false);
  });
});
