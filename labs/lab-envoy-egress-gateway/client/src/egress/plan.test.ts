import { describe, expect, it } from "vitest";
import { parsePlan } from "./plan.js";

describe("parsePlan", () => {
  it("parses a comma-separated list of url@interval entries", () => {
    expect(
      parsePlan("http://a.example.com/x@1000,http://b.example.com/y@20000"),
    ).toEqual([
      { url: "http://a.example.com/x", everyMs: 1000 },
      { url: "http://b.example.com/y", everyMs: 20000 },
    ]);
  });

  it("tolerates surrounding whitespace", () => {
    expect(
      parsePlan(" http://a.example.com/x@1000 , http://b.example.com/y@50 "),
    ).toHaveLength(2);
  });

  it("rejects an empty plan", () => {
    expect(() => parsePlan("  ")).toThrow(/at least one/);
  });

  it("rejects an entry without an interval", () => {
    expect(() => parsePlan("http://a.example.com/x")).toThrow(/url@interval/);
  });

  it("rejects a non-positive interval", () => {
    expect(() => parsePlan("http://a.example.com/x@0")).toThrow(/positive/);
  });

  it("rejects a non-http url", () => {
    expect(() => parsePlan("ftp://a.example.com/x@100")).toThrow(/http/);
  });
});
