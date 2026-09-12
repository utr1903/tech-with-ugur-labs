import { and, asc, between, eq, or, sql } from "drizzle-orm";
import type { Logger } from "../logger.js";
import { logOperation } from "../operation.js";
import { chunks } from "./schema.js";
import type { Store } from "./store.js";
import type { Embed, Evidence, Source } from "./types.js";
import { validateVectors } from "./vectors.js";

function boundContext(rows: Source[], budget: number): Evidence {
	const sources: Source[] = [];
	const parts: string[] = [];
	let remaining = budget;
	for (const row of rows) {
		const prefix = `[${row.filename}#${row.ordinal} id=${row.id}]\n`;
		const separator = parts.length ? 2 : 0;
		const room = remaining - prefix.length - separator;
		if (room < 1) break;
		const text = row.text.slice(0, room);
		sources.push({ ...row, text });
		parts.push(prefix + text);
		remaining -= prefix.length + text.length + separator;
	}
	return { sources, context: parts.join("\n\n") };
}
async function searchCorpus(
	{
		store,
		embed,
		topK,
		contextBudget,
	}: { store: Store; embed: Embed; topK: number; contextBudget: number },
	question: string,
	signal?: AbortSignal,
): Promise<Evidence> {
	signal?.throwIfAborted();
	const vectors = await embed([question], signal);
	validateVectors(vectors, 1);
	const vector = vectors[0];
	if (!vector) throw new Error("Missing query embedding");
	return store.db.transaction(
		async (tx) => {
			signal?.throwIfAborted();
			const distance = sql<number>`${chunks.embedding} <=> ${JSON.stringify(vector)}::vector`;
			const hits = await tx
				.select()
				.from(chunks)
				.orderBy(distance, asc(chunks.id))
				.limit(topK);
			if (!hits.length) return { sources: [], context: "" };
			const neighbors = await tx
				.select({
					id: chunks.id,
					filename: chunks.filename,
					ordinal: chunks.ordinal,
					text: chunks.text,
				})
				.from(chunks)
				.where(
					or(
						...hits.map((hit) =>
							and(
								eq(chunks.filename, hit.filename),
								between(chunks.ordinal, hit.ordinal - 1, hit.ordinal + 1),
							),
						),
					),
				)
				.orderBy(asc(chunks.filename), asc(chunks.ordinal));
			signal?.throwIfAborted();
			return boundContext(neighbors, contextBudget);
		},
		{ isolationLevel: "repeatable read", accessMode: "read only" },
	);
}

export async function retrieveCorpus(
	options: {
		store: Store;
		embed: Embed;
		topK: number;
		contextBudget: number;
		logger: Logger;
	},
	question: string,
	signal?: AbortSignal,
): Promise<Evidence> {
	return logOperation(
		options.logger,
		"Search relevant chunks",
		{
			query: question,
			topK: options.topK,
			contextBudget: options.contextBudget,
		},
		() => searchCorpus(options, question, signal),
		(result) => ({
			sourceCount: result.sources.length,
			contextCharacters: result.context.length,
		}),
	);
}
