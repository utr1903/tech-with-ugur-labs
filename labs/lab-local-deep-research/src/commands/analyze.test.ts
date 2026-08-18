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

  it("strips a <think>...</think> block preceding the answer", () => {
    const result = {
      messages: [
        { text: "<think>weighing the sources</think>\n\nThe answer is 42." },
      ],
    };
    expect(extractAnswer(result)).toBe("The answer is 42.");
  });

  it("returns the answer unchanged when there is no think block", () => {
    const result = { messages: [{ text: "The answer is 42." }] };
    expect(extractAnswer(result)).toBe("The answer is 42.");
  });

  it("takes the text after the last </think> when there is no opening tag", () => {
    const result = {
      messages: [
        {
          text: "leaked reasoning with no opener</think>The answer is 42.",
        },
      ],
    };
    expect(extractAnswer(result)).toBe("The answer is 42.");
  });
});
