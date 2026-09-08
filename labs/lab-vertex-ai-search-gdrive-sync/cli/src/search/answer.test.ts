import { describe, expect, it } from "vitest";
import { UNRELATED_CONTEXT, unrelatedSearchSpec } from "./answer.js";

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
