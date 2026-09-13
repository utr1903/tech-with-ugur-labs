import { expect, it } from "vitest";
import { blockedIp } from "./network-download.js";

it("requires bounded raw IP failure, zero fixture hits, positive controls and marker absence", () => {
  const evidence = {
    exitCode: 28,
    before: 3,
    after: 3,
    positiveBefore: true,
    positiveAfter: true,
    markerExists: false,
  };
  expect(blockedIp(evidence)).toBe(true);
  expect(blockedIp({ ...evidence, exitCode: 6 })).toBe(false);
  expect(blockedIp({ ...evidence, after: 4 })).toBe(false);
  expect(blockedIp({ ...evidence, positiveAfter: false })).toBe(false);
  expect(blockedIp({ ...evidence, markerExists: true })).toBe(false);
});
