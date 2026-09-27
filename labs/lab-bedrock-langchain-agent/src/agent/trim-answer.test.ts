import { describe, expect, it } from "vitest";
import { trimAnswer } from "./trim-answer.js";

describe("trimAnswer", () => {
  it("removes leading and trailing whitespace, including line breaks", () => {
    expect(trimAnswer("\n\n4")).toBe("4");
    expect(trimAnswer("  Vienna  \n")).toBe("Vienna");
  });

  it("leaves an already-trimmed answer unchanged", () => {
    expect(trimAnswer("4 customers")).toBe("4 customers");
  });
});
