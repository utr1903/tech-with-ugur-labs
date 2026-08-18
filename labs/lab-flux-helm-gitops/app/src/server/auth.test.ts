import { describe, expect, it } from "vitest";
import { isAuthorized } from "./auth.js";

describe("isAuthorized", () => {
  it("accepts the exact bearer token", () => {
    expect(isAuthorized("Bearer secret-token", "secret-token")).toBe(true);
  });

  it("rejects a wrong token", () => {
    expect(isAuthorized("Bearer wrong", "secret-token")).toBe(false);
  });

  it("rejects a missing header", () => {
    expect(isAuthorized(undefined, "secret-token")).toBe(false);
  });

  it("rejects a token of different length without throwing", () => {
    expect(isAuthorized("Bearer s", "secret-token")).toBe(false);
  });
});
