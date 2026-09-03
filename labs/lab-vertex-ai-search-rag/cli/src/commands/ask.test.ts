import { describe, expect, it } from "vitest";
import type { AnswerResult } from "../search/answer.js";
import { formatAnswer } from "./ask.js";

const RESULT: AnswerResult = {
  text: "Recursive splitting scored 41.8 points.",
  groundingScore: 0.9,
  skippedReasons: [],
  citedUris: ["gs://demo/corpus/chunking-strategies.md"],
  supports: [{ score: 0.88, uris: ["gs://demo/corpus/chunking-strategies.md"] }],
  chunks: [
    {
      uri: "gs://demo/corpus/chunking-strategies.md",
      title: "t",
      content: "…41.8…",
      relevanceScore: 0.7,
    },
  ],
};

describe("formatAnswer", () => {
  it("shows the answer, the score and the sources", () => {
    const output = formatAnswer(RESULT, { raw: false }).join("\n");

    expect(output).toContain("41.8 points");
    expect(output).toContain("grounding score: 0.9");
    expect(output).toContain("gs://demo/corpus/chunking-strategies.md");
  });

  it("hides the retrieved chunks unless asked for them", () => {
    expect(formatAnswer(RESULT, { raw: false }).join("\n")).not.toContain("retrieved chunks");
    expect(formatAnswer(RESULT, { raw: true }).join("\n")).toContain("retrieved chunks");
  });

  it("says so plainly when there are no citations", () => {
    const output = formatAnswer({ ...RESULT, citedUris: [] }, { raw: false }).join("\n");

    expect(output).toContain("citations: none");
  });
});
