import { describe, expect, it } from "vitest";
import { buildFingerprint } from "./fingerprint.js";

describe("buildFingerprint", () => {
  it("returns the fixed, obviously-fake lab canary", () => {
    expect(buildFingerprint()).toEqual({
      host: "LAB-CANARY-NOT-A-REAL-HOST",
      user: "labuser",
      osBuild: "lab-os-0",
      fingerprint: "FAKE-FP-000-lab-only",
    });
  });

  it("carries the grep canary substring", () => {
    expect(JSON.stringify(buildFingerprint())).toContain("FAKE-FP-000-lab-only");
  });
});
