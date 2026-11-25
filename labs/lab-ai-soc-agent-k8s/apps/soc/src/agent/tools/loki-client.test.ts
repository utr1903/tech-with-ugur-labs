import { describe, expect, it, vi } from "vitest";
import { createLokiClient } from "./loki-client.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe("createLokiClient", () => {
  it("queryRange calls /loki/api/v1/query_range with ns bounds", async () => {
    const fetchFn = vi.fn<typeof fetch>(async () =>
      jsonResponse({
        status: "success",
        data: { resultType: "streams", result: [] },
      }),
    );
    const client = createLokiClient("http://loki:3100", fetchFn);
    const data = await client.queryRange('{a="b"}', 10n, 20n, 5);
    const url = new URL(String(fetchFn.mock.calls[0]?.[0]));
    expect(url.pathname).toBe("/loki/api/v1/query_range");
    expect(url.searchParams.get("query")).toBe('{a="b"}');
    expect(url.searchParams.get("start")).toBe("10");
    expect(url.searchParams.get("end")).toBe("20");
    expect(url.searchParams.get("limit")).toBe("5");
    expect(data.resultType).toBe("streams");
  });

  it("instant calls /loki/api/v1/query", async () => {
    const fetchFn = vi.fn<typeof fetch>(async () =>
      jsonResponse({
        status: "success",
        data: { resultType: "vector", result: [] },
      }),
    );
    await createLokiClient("http://loki:3100", fetchFn).instant(
      'sum({a="b"})',
      7n,
    );
    const url = new URL(String(fetchFn.mock.calls[0]?.[0]));
    expect(url.pathname).toBe("/loki/api/v1/query");
    expect(url.searchParams.get("time")).toBe("7");
  });

  it("throws with the status when Loki rejects the query", async () => {
    const fetchFn = vi.fn(
      async () => new Response("parse error", { status: 400 }),
    );
    await expect(
      createLokiClient("http://loki:3100", fetchFn).instant("x", 1n),
    ).rejects.toThrow(/400/);
  });
});
