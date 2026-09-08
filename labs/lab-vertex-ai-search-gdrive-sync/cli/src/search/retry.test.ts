import { describe, expect, it } from "vitest";
import { isRetryable, withRetry } from "./retry.js";

const silentLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
} as unknown as import("../logger.js").Logger;

describe("isRetryable", () => {
  it("retries the per-project LLM quota error", () => {
    expect(isRetryable({ code: 8, message: "LlmRequestsPerMinutePerProject exceeded" })).toBe(true);
  });

  it("retries a deadline overrun, since grounded generation is slow", () => {
    expect(isRetryable({ code: 4, message: "Deadline exceeded" })).toBe(true);
  });

  it("does not retry a permission error", () => {
    expect(isRetryable({ code: 7, message: "permission denied" })).toBe(false);
  });

  it("does not retry a plain error", () => {
    expect(isRetryable(new Error("boom"))).toBe(false);
  });
});

describe("withRetry", () => {
  it("returns the first successful result without retrying", async () => {
    let calls = 0;

    const result = await withRetry(async () => {
      calls += 1;
      return "ok";
    }, silentLogger);

    expect(result).toBe("ok");
    expect(calls).toBe(1);
  });

  it("retries a retryable failure and then succeeds", async () => {
    let calls = 0;

    const result = await withRetry(
      async () => {
        calls += 1;
        if (calls === 1) {
          throw { code: 8, message: "LlmRequestsPerMinutePerProject exceeded" };
        }
        return "ok";
      },
      silentLogger,
      { attempts: 3, baseDelayMs: 1 },
    );

    expect(result).toBe("ok");
    expect(calls).toBe(2);
  });

  it("gives up on a non-retryable failure immediately", async () => {
    let calls = 0;

    await expect(
      withRetry(
        async () => {
          calls += 1;
          throw { code: 7, message: "permission denied" };
        },
        silentLogger,
        { attempts: 3, baseDelayMs: 1 },
      ),
    ).rejects.toMatchObject({ code: 7 });
    expect(calls).toBe(1);
  });

  it("rethrows after the last attempt", async () => {
    let calls = 0;

    await expect(
      withRetry(
        async () => {
          calls += 1;
          throw { code: 8, message: "quota" };
        },
        silentLogger,
        { attempts: 2, baseDelayMs: 1 },
      ),
    ).rejects.toMatchObject({ code: 8 });
    expect(calls).toBe(2);
  });
});
