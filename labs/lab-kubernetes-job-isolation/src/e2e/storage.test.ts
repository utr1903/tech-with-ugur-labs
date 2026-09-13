import { expect, it } from "vitest";
import { validSeed } from "./storage.js";

it("requires an actual root-owned private synthetic canary rather than treating a missing seed as isolation", () => {
  const seed = {
    exists: true,
    contents: JSON.stringify({ synthetic: true, canary: "FAKE-PII-123" }),
    uid: 0,
    gid: 0,
    mode: 0o600,
    directoryMode: 0o700,
  };
  expect(validSeed(seed)).toBe(true);
  expect(validSeed({ ...seed, exists: false })).toBe(false);
  expect(validSeed({ ...seed, contents: "{}" })).toBe(false);
  expect(validSeed({ ...seed, mode: 0o644 })).toBe(false);
  expect(validSeed({ ...seed, uid: 10001 })).toBe(false);
});
