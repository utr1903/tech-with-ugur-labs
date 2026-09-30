import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { pino } from "pino";
import { describe, expect, it } from "vitest";
import {
  createFirecrawlClient,
  createResearchTools,
} from "./firecrawl-tools.js";
import { createLedger } from "./ledger.js";

interface Request {
  path: string | undefined;
  method: string | undefined;
  body: Record<string, unknown>;
}
async function withTransport(
  respond: (attempt: number) => { status: number; body: object },
  check: (apiUrl: string, requests: Request[]) => Promise<void>,
): Promise<void> {
  const requests: Request[] = [];
  const server = createServer((request, response) => {
    let raw = "";
    request.on("data", (chunk: Buffer) => {
      raw += chunk.toString();
    });
    request.on("end", () => {
      requests.push({
        path: request.url,
        method: request.method,
        body: JSON.parse(raw),
      });
      const result = respond(requests.length);
      response.writeHead(result.status, { "content-type": "application/json" });
      response.end(JSON.stringify(result.body));
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  try {
    await check(`http://127.0.0.1:${address.port}`, requests);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
function setup(apiUrl: string) {
  const logs: string[] = [];
  const ledger = createLedger({
    instruction: "Read article",
    requestedUrls: [],
    invalidEntries: [],
  });
  const firecrawl = createFirecrawlClient("fc-local-placeholder", apiUrl);
  const tools = createResearchTools({
    firecrawl,
    ledger,
    logger: pino(
      {},
      {
        write: (line) => {
          logs.push(line);
        },
      },
    ),
    clock: {
      now: Date.now,
      sleep: async (ms) => {
        await new Promise((resolve) => setTimeout(resolve, ms));
      },
    },
    resolveDns: async () => ["93.184.216.34"],
  });
  return { tools, logs };
}

describe("official Firecrawl SDK transport", () => {
  it("makes one real SDK scrape request and records its evidence", async () => {
    await withTransport(
      () => ({
        status: 200,
        body: {
          success: true,
          data: {
            markdown: "Transport evidence",
            metadata: {
              sourceURL: "https://example.com/article",
              url: "https://example.com/article",
              statusCode: 200,
              title: "Article",
            },
            links: [],
          },
        },
      }),
      async (apiUrl, requests) => {
        const { tools } = setup(apiUrl);
        expect(
          await tools.read_page({ url: "https://example.com/article" }),
        ).toMatchObject({
          ok: true,
          source: { id: "S1", text: "Transport evidence" },
        });
        expect(requests).toHaveLength(1);
        expect(requests[0]).toMatchObject({
          path: "/v2/scrape",
          method: "POST",
          body: {
            url: "https://example.com/article",
            formats: ["markdown", "links"],
          },
        });
        expect(tools.snapshot().counts).toEqual({ calls: 1, reads: 1 });
      },
    );
  });
  it("makes only one real HTTP attempt for a retryable provider error", async () => {
    await withTransport(
      () => ({
        status: 502,
        body: { success: false, error: "Provider fc-response-secret" },
      }),
      async (apiUrl, requests) => {
        const { tools, logs } = setup(apiUrl);
        await expect(tools.search_web({ query: "article" })).rejects.toThrow(
          "Firecrawl operation failed",
        );
        expect(requests).toHaveLength(1);
        expect(requests[0]).toMatchObject({
          path: "/v2/search",
          method: "POST",
        });
        expect(tools.snapshot().counts.calls).toBe(1);
        expect(JSON.stringify(tools.snapshot()) + logs.join("")).not.toContain(
          "fc-response-secret",
        );
      },
    );
  });
  it("does not send a hidden scrape continuation after a processing timeout", async () => {
    await withTransport(
      (attempt) =>
        attempt === 1
          ? {
              status: 408,
              body: {
                success: false,
                code: "SCRAPE_TIMEOUT",
                error: "Timeout fc-response-secret",
                details: {
                  state: "processing_continues",
                  retryAfterSeconds: 0,
                },
              },
            }
          : {
              status: 200,
              body: {
                success: true,
                data: {
                  markdown: "Hidden second request",
                  metadata: {
                    sourceURL: "https://example.com/article",
                    url: "https://example.com/article",
                    statusCode: 200,
                  },
                  links: [],
                },
              },
            },
      async (apiUrl, requests) => {
        const { tools, logs } = setup(apiUrl);
        await expect(
          tools.read_page({ url: "https://example.com/article" }),
        ).rejects.toThrow("Firecrawl operation failed");
        expect(requests).toHaveLength(1);
        expect(requests[0]?.body).not.toHaveProperty("autoResume");
        expect(tools.snapshot().counts).toEqual({ calls: 1, reads: 1 });
        expect(tools.snapshot().sources).toEqual([]);
        expect(tools.snapshot().events).toContainEqual({
          kind: "failure",
          operation: "read_page",
          url: "https://example.com/article",
          reason: "provider-error",
        });
        expect(JSON.stringify(tools.snapshot()) + logs.join("")).not.toContain(
          "fc-response-secret",
        );
      },
    );
  }, 10_000);
});
