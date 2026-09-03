# Reranking: A Second Pass Over Retrieved Results

Vector search is fast, but the same properties that make it fast make it imprecise. An embedding model has to compress the entire meaning of a chunk into a fixed-size vector, and that compression loses information — two chunks can land close together in vector space for reasons that have nothing to do with what the user actually needs. Reranking is a second, more expensive pass that fixes the ordering of an initial set of candidates before anything reaches the final prompt.

The typical pipeline retrieves a wider net than it needs — say the top 50 or 100 candidates by vector similarity — and then hands that smaller set to a reranking model that scores each candidate against the query directly, rather than comparing pre-computed embeddings. Cross-encoder rerankers do this by feeding the query and the candidate document into the model together, letting attention operate across both at once, which captures interactions a bi-encoder embedding comparison simply can't represent.

This is more expensive per document than a vector lookup, which is exactly why it's used as a second stage rather than the primary search mechanism — running a cross-encoder over an entire corpus for every query would be far too slow. Restricting it to a shortlist keeps the extra cost bounded while still catching the cases where the top vector-similarity result isn't actually the most useful one.

In practice, reranking earns its cost most clearly on ambiguous or multi-intent queries, where several candidates are all superficially close to the query embedding but only one actually answers the question being asked. On simple factual lookups the vector search ordering is often already good enough, and reranking mostly just confirms what you already had.

I treat reranking as close to mandatory in any system where retrieval quality directly gates answer quality — which, for RAG, is essentially always. The added latency is usually tens of milliseconds, a cost worth paying against the risk of feeding the model an irrelevant top result.

## Benchmark note

On the Stonewick-11 reranking benchmark, adding a cross-encoder second pass improved top-1 relevance by 27.5 points over vector similarity ordering alone.

*The Stonewick-11 reranking benchmark is fictional. It was invented for this lab so that an answer containing it could only have come from retrieving this document — no model could have learned it during pretraining.*
