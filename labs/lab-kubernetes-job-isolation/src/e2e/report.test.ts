import { describe, expect, it } from "vitest";
import { assess, type Evidence } from "./report.js";

function denial(evidence: Record<string, unknown>): Evidence {
  return {
    operation: "storage denial",
    mode: "secure",
    expected: "denied",
    observed: { status: 200, exitCode: 1, output: "denied" },
    evidence,
    passed: true,
  };
}

describe("evidence assessment", () => {
  it("rejects unknown HTTP200 execution result even when a live Job supports execution", () => {
    expect(
      assess({
        ...denial({
          execution: true,
          jobs: [{ uid: "job", pods: [{ uid: "pod" }] }],
        }),
        observed: { status: 200, output: "unknown" },
      }),
    ).toBe(false);
  });
  it("rejects denial without a successful positive control", () => {
    expect(assess(denial({ denial: true, operatorConfirmed: true }))).toBe(
      false,
    );
  });
  it("rejects worker absence when the operator has not confirmed the fixture", () => {
    expect(
      assess(
        denial({
          denial: true,
          positiveControl: true,
          operatorConfirmed: false,
        }),
      ),
    ).toBe(false);
  });
  it("requires live execution identity for execution observations", () => {
    expect(
      assess(
        denial({
          denial: true,
          positiveControl: true,
          operatorConfirmed: true,
          execution: true,
        }),
      ),
    ).toBe(false);
  });
  it("accepts observed denial with confirmed fixture, positive control and actual Job/pod ids", () => {
    expect(
      assess(
        denial({
          denial: true,
          positiveControl: true,
          operatorConfirmed: true,
          execution: true,
          jobs: [{ uid: "actual-job", pods: [{ uid: "actual-pod" }] }],
        }),
      ),
    ).toBe(true);
  });
  it("rejects unknown observations and preserves an explicitly failed assertion", () => {
    expect(assess({ ...denial({}), observed: {} })).toBe(false);
    expect(
      assess({ ...denial({ operatorConfirmed: true }), passed: false }),
    ).toBe(false);
  });
});
