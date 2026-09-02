import { describe, expect, it } from "vitest";
import { buildPayload } from "./payload.js";

describe("buildPayload", () => {
  it("builds a body of exactly the requested size", () => {
    expect(buildPayload(2048).length).toBe(2048);
  });

  it("builds printable content so a curl of the destination is readable", () => {
    const body = buildPayload(16).toString("utf8");
    expect(body).toMatch(/^[ -~]+$/);
  });

  it("rejects a non-positive size", () => {
    expect(() => buildPayload(0)).toThrow(/positive/);
  });
});
