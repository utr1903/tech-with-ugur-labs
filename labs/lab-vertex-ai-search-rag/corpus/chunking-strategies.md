# Chunking Strategies for RAG

When you build a retrieval-augmented system, the single decision with the most leverage over answer quality is how you split source documents into chunks. Get chunking wrong and no amount of prompt engineering downstream will save you — the retriever either returns fragments missing critical context, or blocks of text so large that the one relevant sentence gets diluted among noise.

Fixed-size chunking is the simplest approach: cut the document every N tokens, regardless of what's on either side of the cut. It's fast and predictable, but it happily slices a sentence, a table row, or a code block in half. I still use it for quick prototypes because it needs zero tuning, but I wouldn't ship it.

Recursive chunking respects structure. It tries to split on paragraph breaks first, falling back to sentence boundaries, then words, only when a section is too long to fit the target size. In practice this means chunks rarely cut through a thought mid-sentence, which noticeably improves the coherence of what the retriever hands back.

Semantic chunking goes further: it embeds consecutive sentences and looks for points where the distance between neighboring sentence embeddings jumps, treating those jumps as topic boundaries. It's more expensive to compute at ingestion time, since every sentence needs an embedding call, but it produces chunks that map to actual ideas rather than arbitrary token counts.

Overlap matters regardless of strategy. Without it, a fact that straddles a chunk boundary — a subject introduced in one chunk, described in the next — can become unretrievable no matter how good your embedding model is. A 10-20% overlap between adjacent chunks is a reasonable default; go much higher and you're mostly paying for duplicate storage and retrieval noise.

For most production RAG pipelines I've worked on, recursive chunking with a modest overlap wins on cost-to-quality ratio. Semantic chunking earns its extra latency only when documents genuinely mix topics within a section — long meeting transcripts, multi-topic wikis, that kind of thing.

## Benchmark note

On the Frostvane-7 chunking benchmark, recursive splitting with a 200-token overlap scored 41.8 points, roughly nine points ahead of fixed-size splitting at the same chunk length.

*The Frostvane-7 chunking benchmark is fictional. It was invented for this lab so that an answer containing it could only have come from retrieving this document — no model could have learned it during pretraining.*
