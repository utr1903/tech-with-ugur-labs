import { describe, expect, it } from "vitest";
import { stripControlSequences } from "./sanitize.js";

describe("stripControlSequences", () => {
  it("removes an OSC 52 clipboard-write payload", () => {
    const osc52 = "\x1b]52;c;aGVsbG8=\x07";
    expect(stripControlSequences(`before${osc52}after`)).toBe("beforeafter");
  });

  it("removes a CSI clear-screen sequence", () => {
    const clearScreen = "\x1b[2J\x1b[H";
    expect(stripControlSequences(`before${clearScreen}after`)).toBe(
      "beforeafter",
    );
  });

  it("removes a bare bell", () => {
    expect(stripControlSequences("before\x07after")).toBe("beforeafter");
  });

  it("removes an OSC sequence terminated by ST (ESC \\) instead of BEL", () => {
    const setTitle = "\x1b]0;pwned\x1b\\";
    expect(stripControlSequences(`before${setTitle}after`)).toBe("beforeafter");
  });

  it("removes a lone, unterminated escape byte", () => {
    expect(stripControlSequences("before\x1bafter")).toBe("beforeafter");
  });

  it("removes DEL", () => {
    expect(stripControlSequences("before\x7fafter")).toBe("beforeafter");
  });

  it("keeps normal text, newlines and tabs intact", () => {
    const text = "line one\n\tline two with a tab\nline three";
    expect(stripControlSequences(text)).toBe(text);
  });
});
