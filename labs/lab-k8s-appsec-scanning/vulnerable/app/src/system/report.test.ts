import { describe, expect, it } from "vitest";
import { buildReport } from "./report.js";

describe("buildReport", () => {
  it("allocates rows chunks of 8 MiB each", () => {
    expect(buildReport(2)).toEqual({ bytes: 2 * 8 * 1024 * 1024 });
  });
  it("allocates nothing for zero rows", () => {
    expect(buildReport(0)).toEqual({ bytes: 0 });
  });
});
