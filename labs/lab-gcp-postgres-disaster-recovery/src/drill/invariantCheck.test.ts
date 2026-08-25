import { describe, expect, it } from "vitest";
import { evaluateInvariant } from "./invariantCheck.js";

describe("evaluateInvariant", () => {
  it("holds when no rows are corrupted and the grand total matches", () => {
    expect(evaluateInvariant(0, 0)).toEqual({
      corruptedRows: 0,
      grandTotalDriftCents: 0,
      holds: true,
    });
  });

  it("fails when rows violate the row invariant", () => {
    expect(evaluateInvariant(412, 0).holds).toBe(false);
  });

  it("fails when the grand total drifts from the control value", () => {
    expect(evaluateInvariant(0, 61_000).holds).toBe(false);
  });
});
