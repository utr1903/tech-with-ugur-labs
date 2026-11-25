import { describe, expect, it } from "vitest";
import { VerdictSchema } from "./verdict.js";

const base = {
  verdict: "malicious",
  confidence: 0.9,
  summary: "A pod read a service account token and called the API.",
  attack_techniques: [{ id: "T1552.007", name: "Container API" }],
  timeline: [],
  affected: [],
  injection_suspected: false,
  proposal_ids: [],
};

describe("VerdictSchema", () => {
  it("accepts a sub-technique id such as T1552.007", () => {
    expect(VerdictSchema.safeParse(base).success).toBe(true);
  });

  it("rejects a malformed technique id such as T12", () => {
    const bad = { ...base, attack_techniques: [{ id: "T12", name: "x" }] };
    expect(VerdictSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects confidence outside 0..1", () => {
    expect(VerdictSchema.safeParse({ ...base, confidence: 1.2 }).success).toBe(
      false,
    );
  });

  it("rejects more than 10 proposal ids", () => {
    const ids = Array.from({ length: 11 }, (_, i) => `p${i}`);
    expect(
      VerdictSchema.safeParse({ ...base, proposal_ids: ids }).success,
    ).toBe(false);
  });
});
