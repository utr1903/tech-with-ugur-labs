import type { BetaMessage } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { describe, expect, it } from "vitest";
import { addUsage, budgetTokens, emptyUsage } from "./usage.js";

function msg(usage: Record<string, number | null | undefined>): BetaMessage {
  return { usage } as unknown as BetaMessage;
}

describe("addUsage", () => {
  it("sums every field and counts the iteration", () => {
    const first = addUsage(
      emptyUsage(),
      msg({
        input_tokens: 10,
        output_tokens: 5,
        cache_read_input_tokens: 100,
        cache_creation_input_tokens: 7,
      }),
    );
    const second = addUsage(
      first,
      msg({ input_tokens: 1, output_tokens: 2, cache_read_input_tokens: 3 }),
    );
    expect(second).toEqual({
      input_tokens: 11,
      output_tokens: 7,
      cache_read_input_tokens: 103,
      cache_creation_input_tokens: 7,
      iterations: 2,
    });
  });

  it("treats null and missing fields as zero", () => {
    const out = addUsage(
      emptyUsage(),
      msg({
        input_tokens: 4,
        output_tokens: null,
        cache_read_input_tokens: undefined,
      }),
    );
    expect(out).toEqual({
      input_tokens: 4,
      output_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
      iterations: 1,
    });
  });
});

describe("budgetTokens", () => {
  it("counts fresh input, cache writes and output but not cache reads", () => {
    expect(
      budgetTokens({
        input_tokens: 10,
        output_tokens: 20,
        cache_read_input_tokens: 99999,
        cache_creation_input_tokens: 30,
        iterations: 3,
      }),
    ).toBe(60);
  });
});
