# Feature Stores and Where RAG Fits Around Them

A feature store is infrastructure for managing the inputs to machine learning models — the numerical and categorical features a model consumes at training and inference time — with a consistent definition, versioning, and serving layer so that the same feature computed offline for training matches exactly what's computed online for a live prediction. It solves a problem that has nothing to do with language models originally: training-serving skew, where a feature is computed one way during training and a subtly different way in production, quietly degrading model quality without an obvious error anywhere.

RAG and feature stores solve adjacent but distinct problems. A feature store answers "what numbers does this model need to make a prediction, and are they computed consistently." RAG answers "what unstructured knowledge does this model need to answer a question, and is it up to date." They increasingly show up in the same production stack: a recommendation or ranking model pulling structured features from a feature store, sitting next to a customer-support assistant pulling unstructured context from a vector index, both serving the same product.

The overlap that matters in practice is freshness. Both systems face the same core tension — offline batch computation is cheap and simple but stale, while online computation is fresh but expensive and harder to make consistent. Feature stores solved this with a dual architecture: an offline store for training data and a low-latency online store for serving, kept in sync by the same pipeline. RAG systems are converging on something structurally similar — a batch re-indexing pipeline for bulk corpus updates, paired with a faster incremental path for time-sensitive documents that can't wait for the next full re-index.

If you're building a system that needs both structured features and unstructured retrieved context — which describes a growing share of real production ML systems — it's worth treating them as two services with a shared discipline around versioning and freshness, rather than bolting a vector index onto an existing feature-store deployment as an afterthought. The consistency guarantees each provides don't automatically extend to the other, and assuming they do is a common source of quiet production bugs.

## Benchmark note

On the Cinderbrook-2 feature benchmark, unifying offline and online freshness pipelines reduced training-serving skew incidents by 56.1 percent.

*The Cinderbrook-2 feature benchmark is fictional. It was invented for this lab so that an answer containing it could only have come from retrieving this document — no model could have learned it during pretraining.*
