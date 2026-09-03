import pino from "pino";
import { describe, expect, it, vi } from "vitest";
import {
  isResourceExhausted,
  MAX_ANSWER_ATTEMPTS,
  QUOTA_RETRY_BASE_DELAY_MS,
  RESOURCE_EXHAUSTED_CODE,
  UNRELATED_CONTEXT,
  unrelatedSearchSpec,
  withQuotaRetry,
} from "./answer.js";

const silentLogger = pino({ enabled: false });

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

describe("isResourceExhausted", () => {
  it("recognizes the quota error's gRPC status code", () => {
    expect(isResourceExhausted({ code: RESOURCE_EXHAUSTED_CODE })).toBe(true);
  });

  it("rejects any other error shape", () => {
    expect(isResourceExhausted({ code: 3 })).toBe(false);
    expect(isResourceExhausted(new Error("boom"))).toBe(false);
    expect(isResourceExhausted(null)).toBe(false);
    expect(isResourceExhausted("boom")).toBe(false);
  });
});

describe("withQuotaRetry", () => {
  it("retries a quota error with exponential backoff, then returns the eventual result", async () => {
    const quotaError = { code: RESOURCE_EXHAUSTED_CODE };
    const call = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(quotaError)
      .mockRejectedValueOnce(quotaError)
      .mockResolvedValueOnce("the answer");
    const delay = vi.fn<(ms: number) => Promise<void>>().mockResolvedValue(undefined);

    const result = await withQuotaRetry(call, silentLogger, delay);

    expect(result).toBe("the answer");
    expect(call).toHaveBeenCalledTimes(3);
    expect(delay.mock.calls).toEqual([
      [QUOTA_RETRY_BASE_DELAY_MS],
      [QUOTA_RETRY_BASE_DELAY_MS * 2],
    ]);
  });

  it("does not retry an error that is not a quota error", async () => {
    const otherError = new Error("permission denied");
    const call = vi.fn<() => Promise<string>>().mockRejectedValue(otherError);
    const delay = vi.fn<(ms: number) => Promise<void>>().mockResolvedValue(undefined);

    await expect(withQuotaRetry(call, silentLogger, delay)).rejects.toBe(otherError);
    expect(call).toHaveBeenCalledTimes(1);
    expect(delay).not.toHaveBeenCalled();
  });

  it("gives up and rethrows once the quota error persists past the attempt limit", async () => {
    const quotaError = { code: RESOURCE_EXHAUSTED_CODE };
    const call = vi.fn<() => Promise<string>>().mockRejectedValue(quotaError);
    const delay = vi.fn<(ms: number) => Promise<void>>().mockResolvedValue(undefined);

    await expect(withQuotaRetry(call, silentLogger, delay)).rejects.toBe(quotaError);
    expect(call).toHaveBeenCalledTimes(MAX_ANSWER_ATTEMPTS);
    expect(delay).toHaveBeenCalledTimes(MAX_ANSWER_ATTEMPTS - 1);
  });
});
