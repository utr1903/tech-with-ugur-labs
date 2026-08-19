import { describe, expect, it } from "vitest";
import { isValidHost, runLookup } from "./lookup.js";

describe("isValidHost", () => {
  it("accepts a simple hostname/IP", () => {
    expect(isValidHost("127.0.0.1")).toBe(true);
    expect(isValidHost("example.com")).toBe(true);
  });
  it("rejects shell metacharacters", () => {
    expect(isValidHost("127.0.0.1; id")).toBe(false);
    expect(isValidHost("$(id)")).toBe(false);
  });
  it("rejects a leading dash (argument injection)", () => {
    expect(isValidHost("-f")).toBe(false);
    expect(isValidHost("-oProxyCommand=id")).toBe(false);
  });
});

describe("runLookup", () => {
  it("rejects an invalid host without executing anything", async () => {
    await expect(runLookup("127.0.0.1; id")).resolves.toContain("invalid host");
  });
});
