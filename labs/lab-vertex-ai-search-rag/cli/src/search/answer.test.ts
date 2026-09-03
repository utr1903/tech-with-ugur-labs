import { describe, expect, it } from "vitest";
import type { AnswerChunk, AnswerSupport } from "./answer.js";
import { shapeAnswer, UNRELATED_CONTEXT, unrelatedSearchSpec } from "./answer.js";

const ANSWER = {
  answerText: "Recursive splitting scored 41.8 points.",
  groundingScore: 0.91,
  citations: [{ startIndex: "0", endIndex: "38", sources: [{ referenceId: "0" }] }],
  groundingSupports: [
    { startIndex: "0", endIndex: "38", groundingScore: 0.88, sources: [{ referenceId: "0" }] },
  ],
  references: [
    {
      unstructuredDocumentInfo: {
        uri: "gs://demo-bucket/corpus/chunking-strategies.md",
        title: "Chunking strategies",
        chunkContents: [{ content: "…scored 41.8 points…", relevanceScore: 0.77 }],
      },
    },
  ],
  answerSkippedReasons: ["NO_RELEVANT_CONTENT"],
};

describe("shapeAnswer", () => {
  it("keeps the answer text and the aggregate grounding score", () => {
    const result = shapeAnswer(ANSWER);

    expect(result.text).toBe("Recursive splitting scored 41.8 points.");
    expect(result.groundingScore).toBe(0.91);
  });

  it("resolves citations to the source documents they point at", () => {
    expect(shapeAnswer(ANSWER).citedUris).toEqual([
      "gs://demo-bucket/corpus/chunking-strategies.md",
    ]);
  });

  it("resolves per-claim grounding supports to their sources", () => {
    const [support] = shapeAnswer(ANSWER).supports;
    const expected: AnswerSupport = {
      score: 0.88,
      uris: ["gs://demo-bucket/corpus/chunking-strategies.md"],
    };

    expect(support).toEqual(expected);
  });

  it("exposes the retrieved chunks behind the answer", () => {
    const [chunk] = shapeAnswer(ANSWER).chunks;
    const expected: AnswerChunk = {
      uri: "gs://demo-bucket/corpus/chunking-strategies.md",
      title: "Chunking strategies",
      content: "…scored 41.8 points…",
      relevanceScore: 0.77,
    };

    expect(chunk).toEqual(expected);
  });

  it("reports the reasons an answer was skipped", () => {
    expect(shapeAnswer(ANSWER).skippedReasons).toEqual(["NO_RELEVANT_CONTENT"]);
  });

  it("survives an answer with nothing in it", () => {
    const empty = shapeAnswer({});

    expect(empty.text).toBe("");
    expect(empty.citedUris).toEqual([]);
    expect(empty.groundingScore).toBeNull();
    expect(empty.skippedReasons).toEqual([]);
  });

  it("ignores a citation whose reference does not exist", () => {
    const result = shapeAnswer({ ...ANSWER, citations: [{ sources: [{ referenceId: "7" }] }] });

    expect(result.citedUris).toEqual([]);
  });
});

describe("unrelatedSearchSpec", () => {
  it("hands the answer generator one irrelevant passage instead of searching the corpus", () => {
    expect(unrelatedSearchSpec()).toEqual({
      searchResultList: {
        searchResults: [
          {
            unstructuredDocumentInfo: {
              uri: "gs://example/unrelated.md",
              title: "Unrelated passage",
              documentContexts: [{ content: UNRELATED_CONTEXT }],
            },
          },
        ],
      },
    });
  });

  it("carries a passage that has nothing to do with the corpus", () => {
    expect(UNRELATED_CONTEXT.toLowerCase()).toContain("tomatoes");
  });
});
