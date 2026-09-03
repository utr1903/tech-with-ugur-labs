import { describe, expect, it } from "vitest";
import { readImportMetadata } from "./import.js";

describe("readImportMetadata", () => {
  it("reads the success and failure counts the operation reports", () => {
    const outcome = readImportMetadata({ successCount: "10", failureCount: "0" });

    expect(outcome).toEqual({ successCount: 10, failureCount: 0, errorSamples: [] });
  });

  it("treats absent counts as zero rather than NaN", () => {
    expect(readImportMetadata({})).toEqual({
      successCount: 0,
      failureCount: 0,
      errorSamples: [],
    });
  });

  it("keeps the error messages so a failed import can be explained", () => {
    const outcome = readImportMetadata({
      successCount: 9,
      failureCount: 1,
      errorSamples: [{ message: "unsupported mimeType" }],
    });

    expect(outcome.failureCount).toBe(1);
    expect(outcome.errorSamples).toEqual(["unsupported mimeType"]);
  });
});
