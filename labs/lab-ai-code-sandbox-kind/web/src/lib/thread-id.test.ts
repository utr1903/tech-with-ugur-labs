import { describe, expect, it } from "vitest";
import { isThreadId } from "./thread-id";

describe("isThreadId", () => {
  it("accepts UUIDs and rejects anything else", () => {
    expect(isThreadId("0b6f1f5e-6a5f-4a39-9d9e-2f4f8f0a6c11")).toBe(true);
    expect(isThreadId("../etc")).toBe(false);
    expect(isThreadId("")).toBe(false);
  });
});
