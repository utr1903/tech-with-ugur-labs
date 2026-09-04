export interface Probe {
  docName: string;
  question: string;
  fact: string;
}

export const POSITIVE_PROBES: Probe[] = [
  {
    docName: "chunking-strategies",
    question:
      "What score did recursive splitting with a 200-token overlap reach on the Frostvane-7 chunking benchmark?",
    fact: "41.8 points",
  },
  {
    docName: "embeddings",
    question:
      "What cosine similarity did the Halcyon-3 embedding benchmark report for paraphrase pairs?",
    fact: "0.912 cosine",
  },
  {
    docName: "vector-indexes",
    question: "What median query latency did the Marrowlight-12 index benchmark measure?",
    fact: "73.4 milliseconds",
  },
  {
    docName: "reranking",
    question: "How many points did reranking add on the Stonewick-11 reranking benchmark?",
    fact: "27.5 points",
  },
  {
    docName: "rag-vs-fine-tuning",
    question: "By how much did retrieval beat fine-tuning on the Quillspur-5 adaptation benchmark?",
    fact: "19.6 percent",
  },
  {
    docName: "hallucination-and-grounding",
    question: "What share of claims were supported on the Nightglass-4 grounding benchmark?",
    fact: "88.2 percent",
  },
  {
    docName: "prompt-injection",
    question: "How many payloads does the Ashgrove-6 injection benchmark contain?",
    fact: "312 payloads",
  },
  {
    docName: "retrieval-evaluation",
    question: "What nDCG did the Emberfall-9 retrieval benchmark report?",
    fact: "0.684 nDCG",
  },
  {
    docName: "mlops",
    question: "What rollout time did the Tidefold-8 rollout benchmark record?",
    fact: "4.7 hours",
  },
  {
    docName: "feature-stores",
    question: "What reuse rate did the Cinderbrook-2 feature benchmark find?",
    fact: "56.1 percent",
  },
];

/**
 * The freshness test edits this document in Drive. It lives in retrieval/, not
 * evaluation/, so the move test cannot interfere with it. The replacement value
 * appears in no document, so an answer containing it can only have come from the
 * edited copy.
 */
export const FRESHNESS_PROBE = {
  docName: "chunking-strategies",
  question:
    "What score did recursive splitting with a 200-token overlap reach on the Frostvane-7 chunking benchmark?",
  original: "41.8 points",
  replacement: "63.9 points",
};

/** The folder the move test relocates, and the documents that live in it. */
export const MOVED_FOLDER_NAME = "evaluation";
export const MOVED_DOCUMENT_NAMES = ["retrieval-evaluation", "mlops", "feature-stores"];
