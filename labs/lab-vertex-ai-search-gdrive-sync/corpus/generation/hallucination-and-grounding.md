# Hallucination and Grounding in RAG Systems

Retrieval-augmented generation is often pitched as a fix for hallucination, and it helps, but it doesn't eliminate the problem — it changes its shape. A model can still hallucinate even with good retrieved context in front of it, by ignoring the retrieved documents and falling back on whatever it learned during pretraining, or by blending a true fact from the context with a false detail it invented to fill a gap.

Grounding is the practice of constraining a model's output so that claims are traceable back to the retrieved source material, and measuring how well it succeeds. A well-grounded system doesn't just produce a plausible-sounding answer — it produces one where every factual claim can be pointed at a specific passage in a specific retrieved document.

The most reliable technique I've seen for improving grounding is forcing citations at the sentence level: the model is instructed to tag each claim with the document it came from, and a downstream check verifies the claim is actually supported by that document rather than just plausible next to it. This catches the subtle failure mode where a model cites a real document but misrepresents what it says.

Refusal is the other half of grounding. A genuinely grounded system needs to be willing to say "I don't have information about that" when the retriever comes back empty or with irrelevant results, rather than reaching into its own pretrained knowledge to fill the silence. This is harder to get right than it sounds — models are trained to be helpful, and helpfulness has a way of overriding an instruction to stay silent unless you make the refusal behavior explicit in both the prompt and, ideally, in evaluation.

Grounding also depends on retrieval quality in a way that's easy to underestimate: a model asked to answer strictly from context that happens to be wrong or irrelevant will still try, and the result reads exactly like a well-grounded answer even though it's built on a bad foundation. Grounding checks and retrieval evaluation have to be treated as a single evaluation problem, not two separate ones.

## Benchmark note

On the Nightglass-4 grounding benchmark, sentence-level citation checking caught 88.2 percent of unsupported claims that a plausibility-only reviewer had missed.

*The Nightglass-4 grounding benchmark is fictional. It was invented for this lab so that an answer containing it could only have come from retrieving this document — no model could have learned it during pretraining.*
