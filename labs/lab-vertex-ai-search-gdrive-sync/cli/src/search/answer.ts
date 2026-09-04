import type { ConversationalSearchServiceClient, protos } from "@google-cloud/discoveryengine";
import type { Logger } from "../logger.js";
import { withRetry } from "./retry.js";
import { type AnswerResult, shapeAnswer } from "./shape.js";

export type { AnswerChunk, AnswerResult, AnswerSupport } from "./shape.js";
export { shapeAnswer } from "./shape.js";

/**
 * The control. Instead of letting the app search the corpus, hand the answer
 * generator one irrelevant passage. Anything it still says about the corpus
 * would have to come from pretraining — which is exactly what we want to rule out.
 */
export const UNRELATED_CONTEXT =
  "Tomatoes ripen faster when kept above 18 degrees Celsius and away from direct sunlight.";

export function unrelatedSearchSpec(): protos.google.cloud.discoveryengine.v1.AnswerQueryRequest.ISearchSpec {
  return {
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
  };
}

/** The client's default 30s deadline is too tight for grounded answer generation. */
const ANSWER_TIMEOUT_MS = 120_000;

export async function askQuestion(
  client: ConversationalSearchServiceClient,
  servingConfig: string,
  question: string,
  options: { withoutRetrieval?: boolean },
  logger: Logger,
): Promise<AnswerResult> {
  const withoutRetrieval = options.withoutRetrieval === true;

  try {
    logger.info({ question, withoutRetrieval }, "Asking the search app...");

    const [response] = await withRetry(
      () =>
        client.answerQuery(
          {
            servingConfig,
            query: { text: question },
            groundingSpec: { includeGroundingSupports: true },
            answerGenerationSpec: {
              includeCitations: true,
              ignoreAdversarialQuery: false,
              ignoreNonAnswerSeekingQuery: false,
            },
            searchSpec: withoutRetrieval
              ? unrelatedSearchSpec()
              : { searchParams: { maxReturnResults: 10 } },
          },
          { timeout: ANSWER_TIMEOUT_MS },
        ),
      logger,
    );
    const result = shapeAnswer(response.answer);

    logger.info(
      {
        question,
        withoutRetrieval,
        citations: result.citedUris.length,
        groundingScore: result.groundingScore,
        skippedReasons: result.skippedReasons,
      },
      "Asking the search app succeeded.",
    );
    return result;
  } catch (err) {
    logger.error({ err, question, withoutRetrieval }, "Asking the search app failed.");
    throw err;
  }
}
