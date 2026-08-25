import { describe, expect, it } from "vitest";
import { EQUIVALENCE_CHECKS, verdicts } from "./equivalence.js";

describe("verdicts", () => {
  it("passes when exact values match and approx values are close", () => {
    const failures = verdicts([
      { name: "node-count", kind: "exact", vanilla: 3, thanos: 3 },
      { name: "cpu-busy-rate", kind: "approx", vanilla: 1.0, thanos: 1.1 },
    ]);
    expect(failures).toEqual([]);
  });

  it("fails when an exact value differs at all", () => {
    const failures = verdicts([
      { name: "node-count", kind: "exact", vanilla: 3, thanos: 4 },
    ]);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("node-count");
  });

  it("fails when an approx value drifts beyond tolerance", () => {
    const failures = verdicts([
      { name: "cpu-busy-rate", kind: "approx", vanilla: 1.0, thanos: 2.0 },
    ]);
    expect(failures).toHaveLength(1);
  });
});

describe("EQUIVALENCE_CHECKS", () => {
  it("covers node counts, memory, and cpu", () => {
    const names = EQUIVALENCE_CHECKS.map((c) => c.name);
    expect(names).toContain("node-count");
    expect(names).toContain("cpu-busy-rate");
  });
});
