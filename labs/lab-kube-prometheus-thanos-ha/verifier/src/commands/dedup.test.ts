import { describe, expect, it } from "vitest";
import { NODE_COUNT } from "../constants.js";
import type { InstantSample } from "../prom/client.js";
import { analyzeDedup } from "./dedup.js";

const sample = (instance: string, replica?: string): InstantSample => ({
  metric: replica ? { instance, prometheus_replica: replica } : { instance },
  value: [1700000000, "1"],
});

// NODE_COUNT (3) distinct instances, each doubled across 2 replicas — the
// shape a healthy raw Thanos response has in this lab.
const threeInstancesRaw: InstantSample[] = [
  sample("a", "r0"),
  sample("a", "r1"),
  sample("b", "r0"),
  sample("b", "r1"),
  sample("c", "r0"),
  sample("c", "r1"),
];
const threeInstancesDeduped: InstantSample[] = [
  sample("a"),
  sample("b"),
  sample("c"),
];

describe("analyzeDedup", () => {
  it("accepts raw=2 replicas per instance collapsing to 1 deduped series each", () => {
    expect(() =>
      analyzeDedup(threeInstancesRaw, threeInstancesDeduped),
    ).not.toThrow();
  });

  it(`rejects a raw view that doesn't cover exactly ${NODE_COUNT} instances`, () => {
    const raw = [sample("a", "r0"), sample("a", "r1"), sample("b", "r0")];
    const deduped = [sample("a"), sample("b")];
    expect(() => analyzeDedup(raw, deduped)).toThrow(
      /covers 2 instances, expected exactly 3/,
    );
  });

  it("rejects an instance with fewer than 2 replicas in the raw view", () => {
    const raw = [
      sample("a", "r0"),
      sample("b", "r0"),
      sample("b", "r1"),
      sample("c", "r0"),
      sample("c", "r1"),
    ];
    const deduped = [sample("a"), sample("b"), sample("c")];
    expect(() => analyzeDedup(raw, deduped)).toThrow(/2 distinct replicas/);
  });

  it("rejects a deduped view that still contains duplicates", () => {
    const deduped = [sample("a"), sample("a"), sample("b")];
    expect(() => analyzeDedup(threeInstancesRaw, deduped)).toThrow(
      /exactly once/,
    );
  });
});
