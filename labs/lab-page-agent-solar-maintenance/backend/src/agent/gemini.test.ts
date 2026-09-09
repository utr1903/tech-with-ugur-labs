import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../config.js";
import { createLogger } from "../logger.js";
import { createGeminiTransport } from "./gemini.js";

const config = loadConfig({
  LLM_MODE: "gemini",
  GEMINI_API_KEY: "server-side-key",
  GEMINI_MODEL: "gemini-3.8-flash",
});
const logger = createLogger({ appName: "test" });

const request = {
  model: "gemini-3.8-flash",
  max_tokens: 2048,
  messages: [{ role: "user", content: "hi" }],
};

function stubFetch(response: Response) {
  const fetchMock = vi.fn(async () => response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createGeminiTransport", () => {
  it("sends the server's key and nothing else", async () => {
    const fetchMock = stubFetch(Response.json({ ok: true }));
    await createGeminiTransport(config, logger)(request);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    );
    // Exactly these headers, so no inbound header can ever ride along.
    const headers = init.headers as Record<string, string>;
    expect(Object.keys(headers).sort()).toEqual([
      "Authorization",
      "Content-Type",
    ]);
    expect(headers.Authorization).toBe("Bearer server-side-key");
  });

  it("returns the upstream body on success", async () => {
    stubFetch(Response.json({ choices: [{ index: 0 }] }));
    await expect(
      createGeminiTransport(config, logger)(request),
    ).resolves.toEqual({
      choices: [{ index: 0 }],
    });
  });

  it("throws on a non-OK upstream response", async () => {
    stubFetch(new Response("nope", { status: 500 }));
    await expect(
      createGeminiTransport(config, logger)(request),
    ).rejects.toThrow(/500/);
  });

  it("never lets a credential-shaped upstream body reach the logs", async () => {
    // A verbose upstream that echoes the request back must not put a live key
    // into our error message, and from there into the log file.
    stubFetch(
      new Response("bad request: Authorization: Bearer server-side-key", {
        status: 400,
      }),
    );
    const forward = createGeminiTransport(config, logger);
    await expect(forward(request)).rejects.toThrow(/Bearer \[redacted\]/);
    await expect(forward(request)).rejects.not.toThrow(/server-side-key/);
  });
});
