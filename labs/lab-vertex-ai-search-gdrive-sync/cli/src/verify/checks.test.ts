import { describe, expect, it } from "vitest";
import type { AnswerResult } from "../search/answer.js";
import {
  checkCitesDocument,
  checkContainsFact,
  checkCount,
  checkExactly,
  checkGrounded,
  checkIdsAbsent,
  checkIdsPresent,
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

describe("checkCitesDocument", () => {
  const EXPECTED_URI = "gs://b/corpus/1AbCdEf.md";

  it("passes when the answer cites the staged object for that Doc", () => {
    expect(
      checkCitesDocument("cites", answer({ citedUris: [EXPECTED_URI] }), EXPECTED_URI).passed,
    ).toBe(true);
  });

  it("fails when the citation points at a different document", () => {
    expect(
      checkCitesDocument("cites", answer({ citedUris: ["gs://b/corpus/2Other.md"] }), EXPECTED_URI)
        .passed,
    ).toBe(false);
  });

  it("fails when there are no citations at all", () => {
    expect(checkCitesDocument("cites", answer({ citedUris: [] }), EXPECTED_URI).passed).toBe(false);
  });

  it("does not accept a partial match on the file id", () => {
    expect(
      checkCitesDocument("cites", answer({ citedUris: ["gs://b/other/1AbCdEf.txt"] }), EXPECTED_URI)
        .passed,
    ).toBe(false);
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
});

describe("id set checks", () => {
  it("requires every expected id to be present", () => {
    expect(checkIdsPresent("present", ["a", "b"], ["a"]).passed).toBe(true);
    expect(checkIdsPresent("present", ["a"], ["a", "b"]).detail).toContain("b");
  });

  it("requires forbidden ids to be gone", () => {
    expect(checkIdsAbsent("absent", ["a"], ["b"]).passed).toBe(true);
    expect(checkIdsAbsent("absent", ["a", "b"], ["b"]).passed).toBe(false);
  });

  it("requires an exact set, ignoring order", () => {
    expect(checkExactly("exact", ["b", "a"], ["a", "b"]).passed).toBe(true);
    expect(checkExactly("exact", ["a"], ["a", "b"]).passed).toBe(false);
    expect(checkExactly("exact", ["a", "b", "c"], ["a", "b"]).passed).toBe(false);
  });
});

describe("count check and summary", () => {
  it("checks a count against what was expected", () => {
    expect(checkCount("count", 10, 10).passed).toBe(true);
    expect(checkCount("count", 9, 10).detail).toBe("9 (expected 10)");
  });

  it("summarises the run", () => {
    const checks = [
      checkContainsFact("a", answer(), "41.8 points"),
      checkGrounded("b", answer({ groundingScore: 0 }), 0.6),
    ];

    expect(summarize(checks)).toEqual({ total: 2, failed: 1, ok: false });
  });
});
