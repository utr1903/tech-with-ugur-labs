import { describe, expect, it } from "vitest";
import type { InstantSample } from "../prom/client.js";
import { analyzeDedup } from "./dedup.js";

const sample = (instance: string, replica?: string): InstantSample => ({
  metric: replica ? { instance, prometheus_replica: replica } : { instance },
  value: [1700000000, "1"],
});

describe("analyzeDedup", () => {
  it("accepts raw=2 replicas per instance collapsing to 1 deduped series each", () => {
    const raw = [
      sample("a", "r0"),
      sample("a", "r1"),
      sample("b", "r0"),
      sample("b", "r1"),
    ];
    const deduped = [sample("a"), sample("b")];
    expect(() => analyzeDedup(raw, deduped)).not.toThrow();
  });

  it("rejects an instance with fewer than 2 replicas in the raw view", () => {
    const raw = [sample("a", "r0"), sample("b", "r0"), sample("b", "r1")];
    const deduped = [sample("a"), sample("b")];
    expect(() => analyzeDedup(raw, deduped)).toThrow(/2 distinct replicas/);
  });

  it("rejects a deduped view that still contains duplicates", () => {
    const raw = [sample("a", "r0"), sample("a", "r1")];
    const deduped = [sample("a"), sample("a")];
    expect(() => analyzeDedup(raw, deduped)).toThrow(/exactly once/);
  });
});
