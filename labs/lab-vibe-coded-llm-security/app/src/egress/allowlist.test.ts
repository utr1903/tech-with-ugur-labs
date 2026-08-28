import { describe, expect, it } from "vitest";
import { isAllowedUrl } from "./allowlist.js";

describe("isAllowedUrl", () => {
  it("denies everything when the allow-list is empty", () => {
    expect(isAllowedUrl("http://attacker:9000/x", [])).toBe(false);
  });

  it("denies a host not on the allow-list", () => {
    expect(isAllowedUrl("http://attacker:9000/x", ["cdn.example.com"])).toBe(
      false,
    );
  });

  it("allows a host on the allow-list", () => {
    expect(isAllowedUrl("http://cdn.example.com/x", ["cdn.example.com"])).toBe(
      true,
    );
  });

  it("denies a malformed URL (default-deny)", () => {
    expect(isAllowedUrl("not a url", ["cdn.example.com"])).toBe(false);
  });
});
