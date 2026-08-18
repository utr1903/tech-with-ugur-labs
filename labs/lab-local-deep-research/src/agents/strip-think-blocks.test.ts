import { describe, expect, it } from "vitest";
import { stripThinkBlocks } from "./strip-think-blocks.js";

describe("stripThinkBlocks", () => {
  it("strips a closed <think>...</think> block", () => {
    expect(stripThinkBlocks("<think>pondering</think>\n\nAnswer.")).toBe(
      "Answer.",
    );
  });

  it("strips leading reasoning ending in a stray </think>", () => {
    expect(stripThinkBlocks("leaked reasoning</think>Answer.")).toBe("Answer.");
  });

  it("returns text without think markers unchanged", () => {
    expect(stripThinkBlocks("Answer.")).toBe("Answer.");
  });

  it("returns an empty string for pure reasoning", () => {
    expect(stripThinkBlocks("<think>only reasoning</think>")).toBe("");
  });
});
