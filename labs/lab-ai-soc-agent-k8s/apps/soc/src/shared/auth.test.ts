import { describe, expect, it } from "vitest";
import { bearerMatches } from "./auth.js";

describe("bearerMatches", () => {
  it("accepts the exact token", () => {
    expect(bearerMatches("Bearer secret-1", "secret-1")).toBe(true);
  });

  it("rejects a wrong token of the same length", () => {
    expect(bearerMatches("Bearer secret-2", "secret-1")).toBe(false);
  });

  it("rejects a token of a different length", () => {
    expect(bearerMatches("Bearer secret-11", "secret-1")).toBe(false);
  });

  it("rejects a missing header", () => {
    expect(bearerMatches(undefined, "secret-1")).toBe(false);
  });

  it("rejects a header without the Bearer scheme", () => {
    expect(bearerMatches("secret-1", "secret-1")).toBe(false);
  });

  it("never accepts anything when the expected token is empty", () => {
    expect(bearerMatches("Bearer ", "")).toBe(false);
  });
});
