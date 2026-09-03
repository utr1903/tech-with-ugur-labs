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

interface RawDocumentMetadata {
  uri?: string | null;
  title?: string | null;
}

interface RawChunkInfo {
  content?: string | null;
  relevanceScore?: number | null;
  documentMetadata?: RawDocumentMetadata | null;
}

interface RawReference {
  unstructuredDocumentInfo?: {
    uri?: string | null;
    title?: string | null;
    chunkContents?: Array<{ content?: string | null; relevanceScore?: number | null }> | null;
  } | null;
  chunkInfo?: RawChunkInfo | null;
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

/**
 * A data store names its reference's source document differently depending on
 * which retrieval shape it returns: unstructured-document search nests it
 * under `unstructuredDocumentInfo`, chunk-based search under `chunkInfo`.
 * Both are read here so citations resolve regardless of which shape a given
 * data store uses.
 */
function referenceUri(reference: RawReference): string | null {
  return (
    reference.unstructuredDocumentInfo?.uri ?? reference.chunkInfo?.documentMetadata?.uri ?? null
  );
}

function referenceTitle(reference: RawReference): string {
  return (
    reference.unstructuredDocumentInfo?.title ?? reference.chunkInfo?.documentMetadata?.title ?? ""
  );
}

function referenceChunks(reference: RawReference): AnswerChunk[] {
  const uri = referenceUri(reference) ?? "";
  const title = referenceTitle(reference);

  const fromUnstructured = (reference.unstructuredDocumentInfo?.chunkContents ?? []).map(
    (chunk) => ({
      uri,
      title,
      content: chunk.content ?? "",
      relevanceScore: chunk.relevanceScore ?? null,
    }),
  );

  const { chunkInfo } = reference;
  const fromChunkInfo = chunkInfo
    ? [
        {
          uri,
          title,
          content: chunkInfo.content ?? "",
          relevanceScore: chunkInfo.relevanceScore ?? null,
        },
      ]
    : [];

  return [...fromUnstructured, ...fromChunkInfo];
}

function uriOf(references: RawReference[], source: RawSource): string | null {
  const index = Number(source.referenceId);
  if (!Number.isInteger(index)) {
    return null;
  }
  const reference = references[index];
  return reference ? referenceUri(reference) : null;
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

  return {
    text: raw.answerText ?? "",
    groundingScore: raw.groundingScore ?? null,
    skippedReasons: raw.answerSkippedReasons ?? [],
    citedUris,
    supports: (raw.groundingSupports ?? []).map((support) => ({
      score: support.groundingScore ?? null,
      uris: urisOf(references, support.sources),
    })),
    chunks: references.flatMap(referenceChunks),
  };
}
