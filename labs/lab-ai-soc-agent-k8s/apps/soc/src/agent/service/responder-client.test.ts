import { describe, expect, it } from "vitest";
import { createResponderClient } from "./responder-client.js";
import { proposal, verdict } from "./test-support.js";

const req = {
  investigationId: "inv-1",
  items: [{ verdict: verdict(), proposals: [proposal("p1")] }],
};

describe("createResponderClient", () => {
  it("posts with the bearer token and parses outcomes", async () => {
    let seen: { url: string; init?: RequestInit } | undefined;
    const fetchFn = (async (url: string, init?: RequestInit) => {
      seen = { url, init };
      return Response.json({
        outcomes: [
          { proposal: proposal("p1"), status: "executed", reason: "ok" },
        ],
      });
    }) as unknown as typeof fetch;
    const out = await createResponderClient(
      "http://r:8081",
      "tok",
      fetchFn,
    ).send(req);
    expect(seen?.url).toBe("http://r:8081/actions");
    expect(
      ((seen?.init?.headers ?? {}) as Record<string, string>).authorization,
    ).toBe("Bearer tok");
    expect(out[0]?.status).toBe("executed");
  });

  it("throws on a non-2xx response", async () => {
    const fetchFn = (async () =>
      new Response("no", { status: 500 })) as unknown as typeof fetch;
    await expect(
      createResponderClient("http://r", "t", fetchFn).send(req),
    ).rejects.toThrow("500");
  });
});
