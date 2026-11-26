import type { BetaMessage } from "@anthropic-ai/sdk/resources/beta/messages/messages";

export type Usage = {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
  iterations: number;
};

export function emptyUsage(): Usage {
  return {
    input_tokens: 0,
    output_tokens: 0,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
    iterations: 0,
  };
}

/**
 * Tokens that count against the investigation budget: fresh input, tokens
 * written to the prompt cache and output. Cache reads are excluded: with
 * caching, uncached input is near zero and re-reading history is cheap.
 */
export function budgetTokens(u: Usage): number {
  return u.input_tokens + u.cache_creation_input_tokens + u.output_tokens;
}

/** Adds one model turn to the running totals; missing or null counts are 0. */
export function addUsage(a: Usage, m: BetaMessage): Usage {
  const u = m.usage;
  return {
    input_tokens: a.input_tokens + (u.input_tokens ?? 0),
    output_tokens: a.output_tokens + (u.output_tokens ?? 0),
    cache_read_input_tokens:
      a.cache_read_input_tokens + (u.cache_read_input_tokens ?? 0),
    cache_creation_input_tokens:
      a.cache_creation_input_tokens + (u.cache_creation_input_tokens ?? 0),
    iterations: a.iterations + 1,
  };
}
