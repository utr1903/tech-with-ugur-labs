import { describe, expect, it, vi } from "vitest";
import { createLogger } from "../logger.js";
import { chat } from "./ollama-client.js";

const logger = createLogger({ appName: "test" });

describe("chat", () => {
  it("posts to /api/generate with deterministic options and returns the response text", async () => {
    const fetchFn = vi.fn(async () => ({
      ok: true,
      json: async () => ({ response: "hello" }),
    })) as unknown as typeof fetch;

    const result = await chat(
      { baseUrl: "http://ollama:11434", model: "qwen2.5:3b", logger, fetchFn },
      "say hi",
    );

    expect(result).toBe("hello");
    expect(fetchFn).toHaveBeenCalledWith(
      "http://ollama:11434/api/generate",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          model: "qwen2.5:3b",
          prompt: "say hi",
          stream: false,
          options: { temperature: 0, seed: 0, top_k: 1 },
        }),
      }),
    );
  });

  it("throws and logs on a non-ok response", async () => {
    const fetchFn = vi.fn(async () => ({
      ok: false,
      json: async () => ({}),
    })) as unknown as typeof fetch;

    await expect(
      chat(
        {
          baseUrl: "http://ollama:11434",
          model: "qwen2.5:3b",
          logger,
          fetchFn,
        },
        "say hi",
      ),
    ).rejects.toThrow();
  });
});
