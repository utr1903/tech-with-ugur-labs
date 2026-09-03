import type { ConversationalSearchServiceClient, protos } from "@google-cloud/discoveryengine";
import type { Logger } from "../logger.js";
import { type AnswerResult, shapeAnswer } from "./shape.js";

export type { AnswerResult } from "./shape.js";

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

/** gRPC status code for RESOURCE_EXHAUSTED — what the answer-generation quota reports. */
export const RESOURCE_EXHAUSTED_CODE = 8;
/** Total attempts at one answerQuery call, including the first — 3 retries beyond it. */
export const MAX_ANSWER_ATTEMPTS = 4;
/** First retry waits this long; each further retry doubles it. */
export const QUOTA_RETRY_BASE_DELAY_MS = 20_000;

export type DelayFn = (ms: number) => Promise<void>;

const defaultDelay: DelayFn = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function isResourceExhausted(err: unknown): boolean {
  return (
    typeof err === "object" && err !== null && "code" in err && err.code === RESOURCE_EXHAUSTED_CODE
  );
}

/**
 * The per-minute answer-generation quota is well below the ~23 calls a full
 * verification run makes, so a reader hits RESOURCE_EXHAUSTED on a normal run.
 * Retries only that specific condition, with exponential backoff; anything
 * else propagates immediately.
 */
export async function withQuotaRetry<T>(
  call: () => Promise<T>,
  logger: Logger,
  delay: DelayFn = defaultDelay,
): Promise<T> {
  let attempt = 0;
  for (;;) {
    attempt += 1;
    try {
      return await call();
    } catch (err) {
      if (!isResourceExhausted(err) || attempt >= MAX_ANSWER_ATTEMPTS) {
        throw err;
      }
      const waitMs = QUOTA_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);
      logger.warn(
        { err, attempt, maxAttempts: MAX_ANSWER_ATTEMPTS, waitMs },
        `Answer quota exceeded, retrying (attempt ${attempt} of ${MAX_ANSWER_ATTEMPTS})...`,
      );
      await delay(waitMs);
    }
  }
}

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

    const [response] = await withQuotaRetry(
      () =>
        client.answerQuery({
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
        }),
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
