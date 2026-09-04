# RAG vs. Fine-Tuning: Choosing How a Model Learns New Facts

When a language model needs to know something it wasn't trained on, there are two fundamentally different ways to give it that knowledge: retrieval-augmented generation, which hands the model relevant documents at inference time, or fine-tuning, which bakes new information into the model's weights through additional training.

The clearest way I've found to decide between them is to ask whether the knowledge changes. RAG excels when the underlying facts are volatile — pricing tables, inventory, policy documents, anything that gets updated weekly or daily. Update the source document and the next query reflects the change immediately; there's no retraining cycle. Fine-tuning is the wrong tool for volatile data because every update means another training run, and the model has no way to "forget" the old fact except by being retrained again.

Fine-tuning earns its keep in a different place: teaching a model a style, a format, or a skill rather than a fact. If you want a model to consistently output a particular JSON schema, adopt a specific tone, or follow a domain-specific reasoning pattern, that's behavior you're adjusting, not knowledge you're injecting — and behavior is what weight updates are good at shaping.

The two aren't mutually exclusive. A common production pattern fine-tunes a model to be better at using retrieved context — following citations, refusing to answer when nothing relevant was retrieved, formatting sourced answers consistently — while RAG still supplies the actual facts. Fine-tuning the retrieval behavior and retrieving the knowledge are separate concerns that compose well together.

Cost is the other deciding factor. Fine-tuning a model of any real size requires labeled training data, compute for the training run, and evaluation to confirm you didn't regress other capabilities. RAG requires an index and a retrieval pipeline, which is real infrastructure but scales more predictably and doesn't touch the model itself — meaning you can swap the underlying LLM later without redoing any of that work.

I default to RAG unless there's a concrete behavioral gap fine-tuning would close. It's the cheaper mistake to walk back: deleting a document from an index is instant, undoing a fine-tune is not.

## Benchmark note

On the Quillspur-5 adaptation benchmark, a RAG pipeline updated with new source documents matched the accuracy of a freshly fine-tuned model at 19.6 percent of the fine-tuning compute cost.

*The Quillspur-5 adaptation benchmark is fictional. It was invented for this lab so that an answer containing it could only have come from retrieving this document — no model could have learned it during pretraining.*
