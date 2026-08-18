// src/search/topic-slug.test.ts
import { describe, expect, it } from "vitest";
import { toTopicSlug } from "./topic-slug.js";

describe("toTopicSlug", () => {
  it("lowercases and hyphenates a question", () => {
    expect(toTopicSlug("What is the Model Context Protocol?")).toBe(
      "what-is-the-model-context-protocol",
    );
  });

  it("collapses consecutive separators and trims edges", () => {
    expect(toTopicSlug("  C++ vs. Rust -- which?! ")).toBe("c-vs-rust-which");
  });

  it("caps length at 60 characters without a trailing hyphen", () => {
    const slug = toTopicSlug(`${"a".repeat(59)} bcdef`);
    expect(slug.length).toBeLessThanOrEqual(60);
    expect(slug.endsWith("-")).toBe(false);
  });

  it("falls back to 'topic' for input with no usable characters", () => {
    expect(toTopicSlug("???")).toBe("topic");
  });
});
