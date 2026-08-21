import { describe, expect, it } from "vitest";
import { buildFingerprint } from "./fingerprint.js";

describe("buildFingerprint", () => {
  it("returns the fixed, self-labeling lab canary and reads nothing real", () => {
    expect(buildFingerprint()).toEqual({
      host: "LAB-CANARY-NOT-A-REAL-HOST",
      user: "labuser",
      osBuild: "lab-os-0",
      fingerprint: "FAKE-FP-000-lab-only",
    });
  });
});
