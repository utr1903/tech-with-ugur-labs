import { describe, expect, it, vi } from "vitest";
import { setup } from "./firecrawl-test-utils.js";

describe("crawl errors and deadlines", () => {
  it("preserves polling authentication failure when cancellation DNS is denied", async () => {
    const { tools, firecrawl, setAnswers, logs } = setup();
    firecrawl.getCrawlStatus = async () => {
      setAnswers(["127.0.0.1"]);
      throw Object.assign(new Error("Polling fc-primary-secret"), {
        status: 401,
      });
    };
    await expect(
      tools.crawl_site({ url: "https://example.com/" }),
    ).rejects.toThrow("Firecrawl authentication failed");
    expect(tools.snapshot().events).toContainEqual({
      kind: "failure",
      operation: "crawl_site",
      url: "https://example.com/",
      reason: "authentication",
    });
    expect(tools.snapshot().events).toContainEqual({
      kind: "denial",
      operation: "crawl_cancel",
      url: "https://example.com/",
      reason: "dns-private",
    });
    expect(JSON.stringify(tools.snapshot()) + logs.join("")).not.toContain(
      "fc-primary-secret",
    );
  });
  it.each([
    [
      401,
      500,
      "Firecrawl authentication failed",
      "authentication",
      "provider-error",
    ],
    [
      500,
      401,
      "Firecrawl operation failed",
      "provider-error",
      "authentication",
    ],
  ])(
    "preserves polling status %s when cancellation fails with %s",
    async (
      primaryStatus,
      cleanupStatus,
      message,
      primaryReason,
      cleanupReason,
    ) => {
      const { tools, firecrawl, logs } = setup();
      firecrawl.getCrawlStatus = async () => {
        throw Object.assign(new Error("Polling fc-primary-secret"), {
          status: primaryStatus,
        });
      };
      firecrawl.cancelCrawl = async () => {
        throw Object.assign(new Error("Cancellation fc-cleanup-secret"), {
          status: cleanupStatus,
        });
      };
      await expect(
        tools.crawl_site({ url: "https://example.com/" }),
      ).rejects.toThrow(String(message));
      expect(tools.snapshot().events).toContainEqual({
        kind: "failure",
        operation: "crawl_site",
        url: "https://example.com/",
        reason: primaryReason,
      });
      expect(tools.snapshot().events).toContainEqual({
        kind: "failure",
        operation: "crawl_cancel",
        url: "https://example.com/",
        reason: cleanupReason,
      });
      expect(JSON.stringify(tools.snapshot()) + logs.join("")).not.toContain(
        "fc-primary-secret",
      );
      expect(JSON.stringify(tools.snapshot()) + logs.join("")).not.toContain(
        "fc-cleanup-secret",
      );
    },
  );
  it("returns a time cap when an empty crawl status arrives after the deadline", async () => {
    const { tools, firecrawl, setTime } = setup();
    firecrawl.getCrawlStatus = async () => {
      setTime(180_001);
      return {
        id: "job-1",
        status: "completed",
        total: 0,
        completed: 0,
        data: [],
      };
    };
    expect(await tools.crawl_site({ url: "https://example.com/" })).toEqual({
      ok: false,
      recoverable: true,
      reason: "time-budget",
    });
    expect(
      tools
        .snapshot()
        .events.some(
          (event) => event.kind === "cap" && event.reason === "time-budget",
        ),
    ).toBe(true);
  });
  it("propagates crawl page DNS timeout as a run cap", async () => {
    vi.useFakeTimers();
    try {
      const { tools, setResolver, setTime } = setup({ maxDurationMs: 2000 });
      let targetLookups = 0;
      setResolver(async (host) => {
        if (host === "example.com") targetLookups++;
        if (targetLookups >= 3) {
          setTime(2000);
          return new Promise<string[]>(() => {});
        }
        return ["93.184.216.34"];
      });
      const result = tools.crawl_site({ url: "https://example.com/" });
      await vi.advanceTimersByTimeAsync(2001);
      expect(await result).toEqual({
        ok: false,
        recoverable: true,
        reason: "time-budget",
      });
      expect(tools.snapshot().sources).toEqual([]);
      expect(
        tools
          .snapshot()
          .events.some(
            (event) =>
              event.kind === "denial" && event.reason === "time-budget",
          ),
      ).toBe(false);
      expect(
        tools
          .snapshot()
          .events.some(
            (event) => event.kind === "cap" && event.reason === "time-budget",
          ),
      ).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
