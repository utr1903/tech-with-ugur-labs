import { ToolFailure } from "./tool-run.js";

const MAX_RANGE_MS = 6 * 3_600_000;
const UNIT_MS: Record<string, number> = {
  ms: 1,
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
  y: 31_536_000_000,
};
const DURATION = "(?:\\d+(?:ms|[smhdwy]))+";
// Range vectors "[5m]" and subqueries "[1h:5m]"; label regexes like [0-9] don't match.
const RANGE = new RegExp(
  `\\[\\s*(${DURATION})\\s*(?::\\s*(?:${DURATION})?\\s*)?\\]`,
  "g",
);

function durationMs(text: string): number {
  let total = 0;
  for (const [, n, unit] of text.matchAll(/(\d+)(ms|[smhdwy])/g)) {
    total += Number(n) * (UNIT_MS[unit ?? ""] ?? 0);
  }
  return total;
}

/**
 * Metric queries evaluate at "now" and ignore since_minutes, so their own
 * lookback must be bounded here: no offset modifier, no range over 6 hours.
 */
export function assertMetricBounds(query: string): void {
  if (/\boffset\b/i.test(query)) {
    throw new ToolFailure(
      "invalid_query",
      "The offset modifier is not allowed; metric queries evaluate at the current time.",
    );
  }
  for (const m of query.matchAll(RANGE)) {
    if (durationMs(m[1] ?? "") > MAX_RANGE_MS) {
      throw new ToolFailure(
        "range_too_long",
        `Range [${m[1]}] exceeds the 6h maximum for metric queries.`,
      );
    }
  }
}
