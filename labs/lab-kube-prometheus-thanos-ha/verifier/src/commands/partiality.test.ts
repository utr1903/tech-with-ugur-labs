import { describe, expect, it } from "vitest";
import { assertPartiality } from "./partiality.js";

describe("assertPartiality", () => {
  it("accepts two strict subsets that sum to the total", () => {
    expect(() =>
      assertPartiality({ shard0: 10, shard1: 14, total: 24 }),
    ).not.toThrow();
  });

  it("rejects an empty shard", () => {
    expect(() =>
      assertPartiality({ shard0: 0, shard1: 24, total: 24 }),
    ).toThrow(/at least 1/);
  });

  it("rejects a shard that sees everything", () => {
    expect(() =>
      assertPartiality({ shard0: 24, shard1: 24, total: 24 }),
    ).toThrow(/strict subset/);
  });

  it("rejects counts that do not sum to the total", () => {
    expect(() =>
      assertPartiality({ shard0: 10, shard1: 10, total: 24 }),
    ).toThrow(/sum/);
  });
});
