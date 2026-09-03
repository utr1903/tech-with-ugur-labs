import { describe, expect, it } from "vitest";
import type { AnswerChunk, AnswerSupport } from "./shape.js";
import { shapeAnswer } from "./shape.js";

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

// Mirrors a real answerQuery response from a chunk-based data store: the
// reference nests its source under chunkInfo.documentMetadata instead of
// unstructuredDocumentInfo, and relevanceScore sits beside content rather
// than inside a chunkContents array.
const CHUNK_INFO_ANSWER = {
  answerText: "Chunking scored 41.8 points on the recursive strategy.",
  groundingScore: 0.95,
  citations: [{ startIndex: "0", endIndex: "45", sources: [{ referenceId: "0" }] }],
  groundingSupports: [{ groundingScore: 0.9, sources: [{ referenceId: "0" }] }],
  references: [
    {
      chunkInfo: {
        chunk: "",
        content: "…scored 41.8 points…",
        relevanceScore: 0.8999999761581421,
        documentMetadata: {
          uri: "gs://demo-bucket/corpus/chunking-strategies.md",
          title: "Chunking Strategies for RAG",
        },
      },
    },
    {
      chunkInfo: {
        chunk: "",
        content: "…an unrelated passage…",
        relevanceScore: 0.20000000298023224,
        documentMetadata: {
          uri: "gs://demo-bucket/corpus/chunking-strategies.md",
          title: "Chunking Strategies for RAG",
        },
      },
    },
  ],
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

  it("resolves a citation through a chunkInfo reference's documentMetadata", () => {
    expect(shapeAnswer(CHUNK_INFO_ANSWER).citedUris).toEqual([
      "gs://demo-bucket/corpus/chunking-strategies.md",
    ]);
  });

  it("resolves a grounding support through a chunkInfo reference's documentMetadata", () => {
    const [support] = shapeAnswer(CHUNK_INFO_ANSWER).supports;
    const expected: AnswerSupport = {
      score: 0.9,
      uris: ["gs://demo-bucket/corpus/chunking-strategies.md"],
    };

    expect(support).toEqual(expected);
  });

  it("exposes a chunkInfo reference's content and relevance score as a chunk", () => {
    const [chunk] = shapeAnswer(CHUNK_INFO_ANSWER).chunks;
    const expected: AnswerChunk = {
      uri: "gs://demo-bucket/corpus/chunking-strategies.md",
      title: "Chunking Strategies for RAG",
      content: "…scored 41.8 points…",
      relevanceScore: 0.8999999761581421,
    };

    expect(chunk).toEqual(expected);
  });

  it("exposes one chunk per chunkInfo reference", () => {
    expect(shapeAnswer(CHUNK_INFO_ANSWER).chunks).toHaveLength(2);
  });
});
