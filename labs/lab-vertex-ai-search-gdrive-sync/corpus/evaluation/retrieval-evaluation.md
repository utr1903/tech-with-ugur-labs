# Evaluating Retrieval Quality

It's tempting to judge a RAG system purely by whether the final generated answer looks right. That's a mistake — if retrieval returns the wrong documents, a good language model can still produce a fluent, confident, entirely wrong answer, and if you're only looking at the output you'll misdiagnose the failure as a generation problem when it's actually a retrieval problem.

The standard way to evaluate retrieval on its own is with a labeled query set: a collection of realistic queries, each paired with the document IDs that are actually relevant to it. Against that set, you can compute metrics that isolate retrieval quality from generation quality entirely.

Precision@K and Recall@K are the simplest starting points. Precision@K asks: of the top K documents returned, how many were actually relevant? Recall@K asks: of all the relevant documents that exist, how many did we find in the top K? These are useful but blunt — they treat a relevant document at rank 1 the same as one at rank 10, as long as both are within K.

nDCG (normalized Discounted Cumulative Gain) fixes that by weighting relevant results according to their position — a relevant document near the top of the results contributes more to the score than one buried near the bottom, and the score is normalized against the best possible ordering so it's comparable across queries with different numbers of relevant documents. It's the metric I reach for when ranking order genuinely matters to the user experience, which for most RAG applications it does — nobody reads past the first few retrieved chunks.

Building the labeled query set is the actual bottleneck, not the metric math. I've found the fastest reliable approach is to generate candidate query-document pairs with an LLM against your real corpus, then have a human spot-check a sample rather than reviewing every pair by hand. It's not perfect, but it gets you a usable evaluation set in hours instead of weeks, and you can always tighten it later as real user queries come in.

Whatever metric you settle on, re-run it every time you change the embedding model, the chunking strategy, or the index configuration. Retrieval evaluation isn't a one-time gate before launch — it's the thing that tells you whether a change you thought was neutral actually made results worse.

## Benchmark note

On the Emberfall-9 retrieval benchmark, the production index scored 0.684 nDCG against the held-out labeled query set, comfortably ahead of the keyword-search baseline.

*The Emberfall-9 retrieval benchmark is fictional. It was invented for this lab so that an answer containing it could only have come from retrieving this document — no model could have learned it during pretraining.*
