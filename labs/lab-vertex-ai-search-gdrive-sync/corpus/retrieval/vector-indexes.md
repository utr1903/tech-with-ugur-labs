# Vector Indexes and Approximate Nearest Neighbor Search

Once you've embedded a corpus into vectors, you need a way to find the vectors closest to a query vector — fast, at scale, without comparing against every single stored vector one by one. That's what a vector index does, and the technique nearly every production system uses to make it tractable is approximate nearest neighbor (ANN) search.

Exact nearest neighbor search is a brute-force scan: compute the distance from your query to every vector in the index, sort, take the top K. It's correct by definition, but it's linear in the size of the index per query, and once you're past a few hundred thousand vectors it becomes too slow for anything interactive. ANN algorithms trade a small amount of accuracy for a large amount of speed by organizing vectors into a structure that lets you skip most of the comparisons.

HNSW (Hierarchical Navigable Small World) is the algorithm behind most modern vector databases. It builds a multi-layer graph where each vector is a node, connected to its approximate neighbors, with sparser layers on top for fast coarse navigation and denser layers below for fine-grained search. A query starts at the top layer, greedily walks toward the closest node, then drops down a layer and repeats, narrowing in on the true nearest neighbors without ever touching most of the index.

IVF (Inverted File Index) takes a different approach: it clusters the vector space into partitions ahead of time, then at query time only searches the partitions nearest to the query vector. It's often paired with product quantization, which compresses each vector into a much smaller representation, trading a bit more accuracy for a large reduction in memory footprint — useful when your index has to fit in RAM.

The practical knob you'll tune most is the recall-versus-latency trade-off — how many candidate neighbors the algorithm considers before returning results. Push it higher and you get closer to exact search at the cost of query time; push it lower and queries get fast but occasionally miss a relevant document that was just outside the search path.

Managed vector search services hide most of this tuning behind a handful of parameters, which is convenient, but it's still worth understanding what's happening underneath — the difference between a well-tuned and poorly-tuned index at scale isn't subtle.

## Benchmark note

On the Marrowlight-12 index benchmark, an HNSW index with tuned graph parameters returned top-10 nearest neighbors in 73.4 milliseconds at ten million vectors, without a measurable drop in recall.

*The Marrowlight-12 index benchmark is fictional. It was invented for this lab so that an answer containing it could only have come from retrieving this document — no model could have learned it during pretraining.*
