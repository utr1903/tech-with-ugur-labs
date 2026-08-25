import { describe, expect, it } from "vitest";
import type { InstantSample } from "./client.js";
import { approxEqual, singleValue } from "./compare.js";

describe("approxEqual", () => {
  it("accepts exact matches with zero tolerances", () => {
    expect(approxEqual(3, 3, { relTol: 0, absTol: 0 })).toBe(true);
    expect(approxEqual(3, 3.0001, { relTol: 0, absTol: 0 })).toBe(false);
  });

  it("applies relative tolerance against the larger magnitude", () => {
    expect(approxEqual(100, 110, { relTol: 0.1, absTol: 0 })).toBe(true);
    expect(approxEqual(100, 112, { relTol: 0.1, absTol: 0 })).toBe(false);
  });

  it("applies the absolute floor for tiny values", () => {
    expect(approxEqual(0.01, 0.04, { relTol: 0.1, absTol: 0.05 })).toBe(true);
  });
});

describe("singleValue", () => {
  const sample = (v: string): InstantSample => ({
    metric: {},
    value: [1700000000, v],
  });

  it("returns the numeric value of exactly one series", () => {
    expect(singleValue([sample("42")])).toBe(42);
  });

  it("throws when there is not exactly one series", () => {
    expect(() => singleValue([])).toThrow(/expected exactly 1 series/);
    expect(() => singleValue([sample("1"), sample("2")])).toThrow(
      /expected exactly 1 series/,
    );
  });
});
