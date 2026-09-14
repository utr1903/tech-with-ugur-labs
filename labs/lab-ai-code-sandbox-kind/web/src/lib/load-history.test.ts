import { describe, expect, it, vi } from "vitest";
import { loadHistory } from "./load-history";

describe("loadHistory", () => {
  it("fetches the thread's messages", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({
        threadId: "t",
        messages: [{ id: "1", role: "user", parts: [] }],
      }),
    );
    const messages = await loadHistory("t", { fetchImpl });
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/threads/t/messages",
      expect.anything(),
    );
    expect(messages).toHaveLength(1);
  });

  it("throws on a non-OK response", async () => {
    await expect(
      loadHistory("t", {
        fetchImpl: async () => new Response("x", { status: 500 }),
      }),
    ).rejects.toThrow("HTTP 500");
  });
});
