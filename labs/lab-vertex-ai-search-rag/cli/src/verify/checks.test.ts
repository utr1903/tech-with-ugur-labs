import { describe, expect, it } from "vitest";
import type { AnswerResult } from "../search/answer.js";
import {
  checkAbstains,
  checkCitesAll,
  checkCitesOnly,
  checkContainsFact,
  checkDocumentCount,
  checkGrounded,
  checkOmitsFact,
  summarize,
} from "./checks.js";

const URI = "gs://demo/corpus/chunking-strategies.md";

function answer(overrides: Partial<AnswerResult> = {}): AnswerResult {
  return {
    text: "Recursive splitting scored 41.8 points.",
    groundingScore: 0.9,
    skippedReasons: [],
    citedUris: [URI],
    supports: [],
    chunks: [],
    ...overrides,
  };
}

describe("fact checks", () => {
  it("passes when the invented fact is in the answer", () => {
    expect(checkContainsFact("positive", answer(), "41.8 points").passed).toBe(true);
  });

  it("fails when the invented fact is missing, and quotes what came back", () => {
    const check = checkContainsFact("positive", answer({ text: "I don't know." }), "41.8 points");

    expect(check.passed).toBe(false);
    expect(check.detail).toContain("I don't know.");
  });

  it("passes the control only when the fact is absent", () => {
    expect(checkOmitsFact("control", answer({ text: "No idea." }), "41.8 points").passed).toBe(
      true,
    );
    expect(checkOmitsFact("control", answer(), "41.8 points").passed).toBe(false);
  });

  it("records the skip reasons and what text did come back, so a pass shows why", () => {
    const skipped = checkOmitsFact(
      "control",
      answer({ text: "", skippedReasons: ["NO_RELEVANT_CONTENT"] }),
      "41.8 points",
    );
    expect(skipped.detail).toContain("NO_RELEVANT_CONTENT");
    expect(skipped.detail).toContain("(empty answer)");

    const answered = checkOmitsFact(
      "control",
      answer({ text: "I don't have that figure.", skippedReasons: [] }),
      "41.8 points",
    );
    expect(answered.detail).toContain("skipped: []");
    expect(answered.detail).toContain("I don't have that figure.");
  });
});

describe("citation checks", () => {
  it("requires the expected document and no other", () => {
    expect(checkCitesOnly("cites", answer(), URI).passed).toBe(true);
    expect(
      checkCitesOnly("cites", answer({ citedUris: [URI, "gs://demo/corpus/other.md"] }), URI)
        .passed,
    ).toBe(false);
    expect(checkCitesOnly("cites", answer({ citedUris: [] }), URI).passed).toBe(false);
  });

  it("requires every document of a cross-document answer", () => {
    const both = [URI, "gs://demo/corpus/reranking.md"];

    expect(checkCitesAll("both", answer({ citedUris: both }), both).passed).toBe(true);
    expect(checkCitesAll("both", answer(), both).passed).toBe(false);
  });
});

describe("grounding checks", () => {
  it("passes when the score clears the threshold", () => {
    expect(checkGrounded("grounded", answer(), 0.6).passed).toBe(true);
    expect(checkGrounded("grounded", answer({ groundingScore: 0.2 }), 0.6).passed).toBe(false);
  });

  it("treats a missing score as ungrounded", () => {
    expect(checkGrounded("grounded", answer({ groundingScore: null }), 0.6).passed).toBe(false);
  });

  it("accepts abstention either as a skip reason or as an uncited low-grounding answer", () => {
    const skipped = answer({ skippedReasons: ["NO_RELEVANT_CONTENT"], citedUris: [] });
    const quiet = answer({ citedUris: [], groundingScore: 0.1 });
    const confabulated = answer({ citedUris: [], groundingScore: 0.95 });

    expect(checkAbstains("abstains", skipped, 0.3).passed).toBe(true);
    expect(checkAbstains("abstains", quiet, 0.3).passed).toBe(true);
    expect(checkAbstains("abstains", confabulated, 0.3).passed).toBe(false);
  });
});

describe("document count and summary", () => {
  it("checks the indexed document count", () => {
    expect(checkDocumentCount("count", 10, 10).passed).toBe(true);
    expect(checkDocumentCount("count", 9, 10).detail).toContain("9");
  });

  it("summarises the run", () => {
    const checks = [
      checkContainsFact("a", answer(), "41.8 points"),
      checkGrounded("b", answer({ groundingScore: 0 }), 0.6),
    ];

    expect(summarize(checks)).toEqual({ total: 2, failed: 1, ok: false });
  });
});
