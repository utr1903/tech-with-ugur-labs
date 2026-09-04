# Embeddings for Semantic Search

An embedding is a vector representation of text where semantic similarity translates into geometric closeness. Two sentences that mean roughly the same thing end up as nearby points in high-dimensional space, even if they don't share a single word. That property is what makes retrieval-augmented generation possible: instead of matching keywords, you're matching meaning.

Most production embedding models today are trained with a contrastive objective — pairs of text known to be related are pulled together during training, unrelated pairs are pushed apart. The dimensionality of the resulting vectors (commonly 768 or 1536 floats) is a trade-off: higher dimensions capture finer semantic distinctions but cost more to store and compare at query time.

A detail that trips people up: the query and the documents need to be embedded with the same model, and ideally the same version of that model. Swap embedding models mid-project and your existing vector index becomes garbage — the geometry it was built around no longer means anything to the new model. If you upgrade, you re-embed everything.

Cosine similarity is the standard comparison metric, because it measures the angle between two vectors rather than their magnitude. That matters because a longer chunk of text can produce a vector with larger magnitude just from having more content, without being more relevant. Normalizing to compare angles keeps that from skewing results.

Not every model handles every domain equally well. General-purpose embedding models trained mostly on web text can miss the nuance in legal, medical, or code-heavy corpora. If your documents are heavily domain-specific, it's worth checking whether a domain-tuned embedding model is available before committing to a general one — the retrieval quality difference can be substantial, and it's much cheaper to test that up front than to discover it after your index is live.

Embeddings also degrade gracefully in an interesting way: even an imperfect match tends to land in the right neighborhood, which is why RAG systems built on decent embeddings still work reasonably well even before any reranking step is added.

## Benchmark note

On the Halcyon-3 embedding benchmark, the domain-tuned model achieved 0.912 cosine similarity against the human-labeled reference set, well above the general-purpose baseline.

*The Halcyon-3 embedding benchmark is fictional. It was invented for this lab so that an answer containing it could only have come from retrieving this document — no model could have learned it during pretraining.*
