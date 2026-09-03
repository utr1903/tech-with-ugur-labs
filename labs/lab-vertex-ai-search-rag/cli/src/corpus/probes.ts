export interface Probe {
  docId: string;
  question: string;
  fact: string;
}

export const POSITIVE_PROBES: Probe[] = [
  {
    docId: "chunking-strategies",
    question:
      "What score did recursive splitting with a 200-token overlap reach on the Frostvane-7 chunking benchmark?",
    fact: "41.8 points",
  },
  {
    docId: "embeddings",
    question:
      "What cosine similarity did the domain-tuned model achieve against the human-labeled reference set on the Halcyon-3 embedding benchmark?",
    fact: "0.912 cosine",
  },
  {
    docId: "vector-indexes",
    question:
      "How long did an HNSW index with tuned graph parameters take to return top-10 nearest neighbors at ten million vectors on the Marrowlight-12 index benchmark?",
    fact: "73.4 milliseconds",
  },
  {
    docId: "rag-vs-fine-tuning",
    question:
      "What percentage of the fine-tuning compute cost did a RAG pipeline use to match fine-tuned accuracy on the Quillspur-5 adaptation benchmark?",
    fact: "19.6 percent",
  },
  {
    docId: "retrieval-evaluation",
    question:
      "What nDCG did the production index score against the held-out labeled query set on the Emberfall-9 retrieval benchmark?",
    fact: "0.684 nDCG",
  },
  {
    docId: "hallucination-and-grounding",
    question:
      "What percentage of unsupported claims did sentence-level citation checking catch on the Nightglass-4 grounding benchmark?",
    fact: "88.2 percent",
  },
  {
    docId: "reranking",
    question:
      "By how many points did adding a cross-encoder second pass improve top-1 relevance on the Stonewick-11 reranking benchmark?",
    fact: "27.5 points",
  },
  {
    docId: "prompt-injection",
    question:
      "How many payloads did delimiter-based isolation block on the Ashgrove-6 injection benchmark?",
    fact: "312 payloads",
  },
  {
    docId: "mlops",
    question:
      "What was the average time to detect a retrieval regression with staged traffic-split deployment on the Tidefold-8 rollout benchmark?",
    fact: "4.7 hours",
  },
  {
    docId: "feature-stores",
    question:
      "By what percentage did unifying offline and online freshness pipelines reduce training-serving skew incidents on the Cinderbrook-2 feature benchmark?",
    fact: "56.1 percent",
  },
];

/** Nothing in the corpus is about container orchestration — the system should say so. */
export const ABSTENTION_QUESTION =
  "What is the recommended way to configure Kubernetes pod disruption budgets?";

export const CROSS_DOCUMENT_PROBE = {
  question:
    "Compare the score recursive splitting reached on the Frostvane-7 chunking benchmark with the points reranking added on the Stonewick-11 reranking benchmark.",
  docIds: ["chunking-strategies", "reranking"],
  facts: ["41.8 points", "27.5 points"],
};
