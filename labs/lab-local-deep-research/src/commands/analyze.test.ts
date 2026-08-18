import { describe, expect, it } from "vitest";
import { extractAnswer } from "./analyze.js";

describe("extractAnswer", () => {
  it("returns the text of the final message", () => {
    const result = {
      messages: [{ text: "intermediate" }, { text: "final answer" }],
    };
    expect(extractAnswer(result)).toBe("final answer");
  });

  it("returns an empty string when there are no messages", () => {
    expect(extractAnswer({ messages: [] })).toBe("");
  });
});
