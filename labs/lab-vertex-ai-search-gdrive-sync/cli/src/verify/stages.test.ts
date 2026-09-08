import { describe, expect, it } from "vitest";
import type { AnswerResult } from "../search/answer.js";
import { askUntil } from "./stages.js";

const silentLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
} as unknown as import("../logger.js").Logger;

function answer(text: string): AnswerResult {
  return {
    text,
    groundingScore: null,
    skippedReasons: [],
    citedUris: [],
    supports: [],
    chunks: [],
  };
}

describe("askUntil", () => {
  it("returns immediately when the predicate holds on the first attempt", async () => {
    let calls = 0;

    const result = await askUntil(
      async () => {
        calls += 1;
        return answer("yes");
      },
      (candidate) => candidate.text === "yes",
      silentLogger,
      { attempts: 5, intervalMs: 1 },
    );

    expect(result.text).toBe("yes");
    expect(calls).toBe(1);
  });

  it("retries and succeeds once the predicate holds on a later attempt", async () => {
    let calls = 0;

    const result = await askUntil(
      async () => {
        calls += 1;
        return answer(calls < 3 ? "no" : "yes");
      },
      (candidate) => candidate.text === "yes",
      silentLogger,
      { attempts: 5, intervalMs: 1 },
    );

    expect(result.text).toBe("yes");
    expect(calls).toBe(3);
  });

  it("gives up after the attempt cap and returns the last result instead of throwing", async () => {
    let calls = 0;

    const result = await askUntil(
      async () => {
        calls += 1;
        return answer("no");
      },
      (candidate) => candidate.text === "yes",
      silentLogger,
      { attempts: 3, intervalMs: 1 },
    );

    expect(result.text).toBe("no");
    expect(calls).toBe(3);
  });
});
