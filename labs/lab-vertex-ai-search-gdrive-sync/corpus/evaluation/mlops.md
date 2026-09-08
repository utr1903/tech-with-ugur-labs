# MLOps for RAG Systems in Production

Running a RAG pipeline in production means treating it like any other production system: it needs a deployment strategy, monitoring, and a rollback plan, not just a working demo. The parts that are unique to RAG are the corpus and the index — everything else is standard MLOps discipline applied to a system with a retrieval component bolted on.

Deploying a change to a RAG system usually means one of three things changed: the corpus content, the embedding model, or the retrieval and generation logic. Each carries different risk. A corpus update is low-risk and should ship continuously — stale documents actively hurt answer quality, so I'd rather re-index frequently than batch changes into rare, larger releases. An embedding model change is high-risk, because it invalidates the existing index; every document has to be re-embedded and the new index has to be validated against the evaluation set before it goes live, ideally behind a traffic-split rollout rather than a hard cutover.

A staged rollout — sending a small percentage of traffic to the new configuration and comparing quality metrics against the existing baseline before widening the rollout — is the safest way to catch a regression that only shows up under real query patterns rather than the offline evaluation set. Automating that comparison, rather than eyeballing a dashboard, is what actually makes staged rollouts practical to run often instead of only for major changes.

Monitoring a RAG system needs to cover more than uptime and latency. Retrieval quality can silently degrade even when nothing crashes — the corpus drifts out of date, an upstream data source changes format and documents stop parsing cleanly, or query patterns shift toward topics the corpus was never built to cover. Tracking retrieval confidence scores and the rate of "no relevant document found" responses over time catches this kind of quiet decay well before users start complaining.

Rollback needs to be as fast for the index as it is for application code. Keeping the previous index version available and swappable, rather than only versioning the application logic, is what makes it possible to revert a bad embedding-model rollout in minutes rather than re-running a multi-hour re-indexing job under pressure.

## Benchmark note

On the Tidefold-8 rollout benchmark, staged traffic-split deployment with automated quality gates cut the average time to detect a retrieval regression to 4.7 hours.

*The Tidefold-8 rollout benchmark is fictional. It was invented for this lab so that an answer containing it could only have come from retrieving this document — no model could have learned it during pretraining.*
