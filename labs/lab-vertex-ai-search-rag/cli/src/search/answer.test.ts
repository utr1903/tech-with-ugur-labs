import pino from "pino";
import { describe, expect, it, vi } from "vitest";
import type { Logger } from "../logger.js";
import {
  ANSWER_TIMEOUT_MS,
  DEADLINE_EXCEEDED_CODE,
  isRetryable,
  MAX_ANSWER_ATTEMPTS,
  RESOURCE_EXHAUSTED_CODE,
  RETRY_BASE_DELAY_MS,
  UNRELATED_CONTEXT,
  unrelatedSearchSpec,
  withTransientRetry,
} from "./answer.js";

const silentLogger = pino({ enabled: false });

/** A pino logger that records each JSON line it writes, so a test can assert on it. */
function capturingLogger(): { logger: Logger; messages: () => string[] } {
  const lines: string[] = [];
  const logger = pino({}, { write: (line: string) => lines.push(line) });
  return { logger, messages: () => lines.map((line) => JSON.parse(line).msg as string) };
}

describe("unrelatedSearchSpec", () => {
  it("hands the answer generator one irrelevant passage instead of searching the corpus", () => {
    expect(unrelatedSearchSpec()).toEqual({
      searchResultList: {
        searchResults: [
          {
            unstructuredDocumentInfo: {
              uri: "gs://example/unrelated.md",
              title: "Unrelated passage",
              documentContexts: [{ content: UNRELATED_CONTEXT }],
            },
          },
        ],
      },
    });
  });

  it("carries a passage that has nothing to do with the corpus", () => {
    expect(UNRELATED_CONTEXT.toLowerCase()).toContain("tomatoes");
  });
});

describe("ANSWER_TIMEOUT_MS", () => {
  it("is well above the client's default 30s deadline", () => {
    expect(ANSWER_TIMEOUT_MS).toBeGreaterThan(30_000);
  });
});

describe("isRetryable", () => {
  it("recognizes the quota error's gRPC status code", () => {
    expect(isRetryable({ code: RESOURCE_EXHAUSTED_CODE })).toBe(true);
  });

  it("recognizes the deadline error's gRPC status code", () => {
    expect(isRetryable({ code: DEADLINE_EXCEEDED_CODE })).toBe(true);
  });

  it("rejects any other error shape", () => {
    expect(isRetryable({ code: 3 })).toBe(false);
    expect(isRetryable(new Error("boom"))).toBe(false);
    expect(isRetryable(null)).toBe(false);
    expect(isRetryable("boom")).toBe(false);
  });
});

describe("withTransientRetry", () => {
  it("retries a quota error with exponential backoff, then returns the eventual result", async () => {
    const quotaError = { code: RESOURCE_EXHAUSTED_CODE };
    const call = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(quotaError)
      .mockRejectedValueOnce(quotaError)
      .mockResolvedValueOnce("the answer");
    const delay = vi.fn<(ms: number) => Promise<void>>().mockResolvedValue(undefined);

    const result = await withTransientRetry(call, silentLogger, delay);

    expect(result).toBe("the answer");
    expect(call).toHaveBeenCalledTimes(3);
    expect(delay.mock.calls).toEqual([[RETRY_BASE_DELAY_MS], [RETRY_BASE_DELAY_MS * 2]]);
  });

  it("retries a deadline error with exponential backoff, then returns the eventual result", async () => {
    const deadlineError = { code: DEADLINE_EXCEEDED_CODE };
    const call = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(deadlineError)
      .mockResolvedValueOnce("the answer");
    const delay = vi.fn<(ms: number) => Promise<void>>().mockResolvedValue(undefined);

    const result = await withTransientRetry(call, silentLogger, delay);

    expect(result).toBe("the answer");
    expect(call).toHaveBeenCalledTimes(2);
    expect(delay.mock.calls).toEqual([[RETRY_BASE_DELAY_MS]]);
  });

  it("names the condition that fired in the retry warning", async () => {
    const { logger, messages } = capturingLogger();
    const quotaError = { code: RESOURCE_EXHAUSTED_CODE };
    const deadlineError = { code: DEADLINE_EXCEEDED_CODE };
    const call = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(quotaError)
      .mockRejectedValueOnce(deadlineError)
      .mockResolvedValueOnce("the answer");
    const delay = vi.fn<(ms: number) => Promise<void>>().mockResolvedValue(undefined);

    await withTransientRetry(call, logger, delay);

    expect(messages()).toEqual([
      expect.stringContaining("answer quota exceeded"),
      expect.stringContaining("answer call deadline exceeded"),
    ]);
  });

  it("does not retry an error that is neither a quota nor a deadline error", async () => {
    const otherError = new Error("permission denied");
    const call = vi.fn<() => Promise<string>>().mockRejectedValue(otherError);
    const delay = vi.fn<(ms: number) => Promise<void>>().mockResolvedValue(undefined);

    await expect(withTransientRetry(call, silentLogger, delay)).rejects.toBe(otherError);
    expect(call).toHaveBeenCalledTimes(1);
    expect(delay).not.toHaveBeenCalled();
  });

  it("gives up and rethrows once a transient error persists past the attempt limit", async () => {
    const quotaError = { code: RESOURCE_EXHAUSTED_CODE };
    const call = vi.fn<() => Promise<string>>().mockRejectedValue(quotaError);
    const delay = vi.fn<(ms: number) => Promise<void>>().mockResolvedValue(undefined);

    await expect(withTransientRetry(call, silentLogger, delay)).rejects.toBe(quotaError);
    expect(call).toHaveBeenCalledTimes(MAX_ANSWER_ATTEMPTS);
    expect(delay).toHaveBeenCalledTimes(MAX_ANSWER_ATTEMPTS - 1);
  });
});
