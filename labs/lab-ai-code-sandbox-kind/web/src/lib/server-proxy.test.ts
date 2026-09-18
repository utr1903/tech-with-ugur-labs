import pino from "pino";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createServerProxy } from "./server-proxy";

function captureLogger() {
  const lines: Record<string, unknown>[] = [];
  const logger = pino(
    { level: "info" },
    { write: (line: string) => lines.push(JSON.parse(line)) },
  );
  return { logger, lines };
}

describe("forwardToServer", () => {
  const originalFetch = globalThis.fetch;
  const originalServerUrl = process.env.SERVER_URL;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.env.SERVER_URL = originalServerUrl;
  });

  it("forwards only the path and query to SERVER_URL and logs success", async () => {
    process.env.SERVER_URL = "http://server:8080";
    const fetchImpl = vi.fn(
      async (_target: URL, _init?: RequestInit) =>
        new Response("ok", {
          status: 200,
          headers: { "content-type": "text/plain" },
        }),
    );
    globalThis.fetch = fetchImpl as unknown as typeof fetch;
    const { logger, lines } = captureLogger();
    const forwardToServer = createServerProxy({ logger });

    const request = new Request("http://web.example/api/tools?x=1&secret=shh", {
      method: "GET",
    });
    const response = await forwardToServer(request);

    expect(response.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const target = fetchImpl.mock.calls[0]?.[0];
    expect(String(target)).toBe("http://server:8080/api/tools?x=1&secret=shh");

    expect(lines.map((l) => l.msg)).toEqual([
      "Forwarding request to server...",
      "Forwarding request to server succeeded.",
    ]);
    expect(lines[0]?.path).toBe("/api/tools");
    expect(lines[0]?.query).toBeUndefined();
    expect(lines[1]?.status).toBe(200);
  });

  it("logs and re-throws when the upstream fetch rejects", async () => {
    process.env.SERVER_URL = "http://server:8080";
    globalThis.fetch = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    const { logger, lines } = captureLogger();
    const forwardToServer = createServerProxy({ logger });

    const request = new Request("http://web.example/api/chat", {
      method: "POST",
      body: JSON.stringify({ threadId: "t", messages: [] }),
    });

    await expect(forwardToServer(request)).rejects.toThrow("ECONNREFUSED");
    expect(lines.map((l) => l.msg)).toEqual([
      "Forwarding request to server...",
      "Forwarding request to server failed.",
    ]);
  });
});
