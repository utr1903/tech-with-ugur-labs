import type OpenAI from "openai";
import type { Embed, EmbeddingIdentity } from "../corpus/types.js";
import { SafeError } from "../http/errors.js";
export const openAIEmbeddingIdentity: EmbeddingIdentity = {
	provider: "openai",
	model: "text-embedding-3-small",
	dimensions: 1536,
};
export function createEmbedding(client: OpenAI): Embed {
	return async (texts, signal) => {
		try {
			const vectors: number[][] = [];
			for (let start = 0; start < texts.length; start += 32) {
				const batch = texts.slice(start, start + 32);
				const result = await client.embeddings.create(
					{
						model: openAIEmbeddingIdentity.model,
						dimensions: openAIEmbeddingIdentity.dimensions,
						input: batch,
					},
					{ signal },
				);
				const ordered = result.data.sort((a, b) => a.index - b.index);
				if (
					ordered.length !== batch.length ||
					ordered.some(
						(entry, index) =>
							entry.index !== index ||
							entry.embedding.length !== 1536 ||
							entry.embedding.some((value) => !Number.isFinite(value)),
					)
				)
					throw new SafeError("Invalid embedding response");
				vectors.push(...ordered.map((entry) => entry.embedding));
			}
			return vectors;
		} catch {
			throw new SafeError("Embedding operation failed");
		}
	};
}
