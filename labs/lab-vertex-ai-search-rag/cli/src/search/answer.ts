import type { ConversationalSearchServiceClient, protos } from "@google-cloud/discoveryengine";
import type { Logger } from "../logger.js";

export interface AnswerChunk {
  uri: string;
  title: string;
  content: string;
  relevanceScore: number | null;
}

export interface AnswerSupport {
  score: number | null;
  uris: string[];
}

export interface AnswerResult {
  text: string;
  groundingScore: number | null;
  skippedReasons: string[];
  citedUris: string[];
  supports: AnswerSupport[];
  chunks: AnswerChunk[];
}

interface RawSource {
  referenceId?: string | null;
}

interface RawReference {
  unstructuredDocumentInfo?: {
    uri?: string | null;
    title?: string | null;
    chunkContents?: Array<{ content?: string | null; relevanceScore?: number | null }> | null;
  } | null;
}

interface RawAnswer {
  answerText?: string | null;
  groundingScore?: number | null;
  citations?: Array<{ sources?: RawSource[] | null }> | null;
  groundingSupports?: Array<{
    groundingScore?: number | null;
    sources?: RawSource[] | null;
  }> | null;
  references?: RawReference[] | null;
  answerSkippedReasons?: string[] | null;
}

function uriOf(references: RawReference[], source: RawSource): string | null {
  const index = Number(source.referenceId);
  if (!Number.isInteger(index)) {
    return null;
  }
  return references[index]?.unstructuredDocumentInfo?.uri ?? null;
}

function urisOf(references: RawReference[], sources: RawSource[] | null | undefined): string[] {
  return (sources ?? [])
    .map((source) => uriOf(references, source))
    .filter((uri): uri is string => uri !== null);
}

export function shapeAnswer(answer: unknown): AnswerResult {
  const raw = (answer ?? {}) as RawAnswer;
  const references = raw.references ?? [];

  const citedUris = [
    ...new Set((raw.citations ?? []).flatMap((citation) => urisOf(references, citation.sources))),
  ];

  const chunks = references.flatMap((reference) => {
    const info = reference.unstructuredDocumentInfo;
    return (info?.chunkContents ?? []).map((chunk) => ({
      uri: info?.uri ?? "",
      title: info?.title ?? "",
      content: chunk.content ?? "",
      relevanceScore: chunk.relevanceScore ?? null,
    }));
  });

  return {
    text: raw.answerText ?? "",
    groundingScore: raw.groundingScore ?? null,
    skippedReasons: raw.answerSkippedReasons ?? [],
    citedUris,
    supports: (raw.groundingSupports ?? []).map((support) => ({
      score: support.groundingScore ?? null,
      uris: urisOf(references, support.sources),
    })),
    chunks,
  };
}

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

    const [response] = await client.answerQuery({
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
    });
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
