import type { Provider } from "./types.js";

const stop = new Set([
	"what",
	"the",
	"for",
	"are",
	"and",
	"does",
	"how",
	"can",
	"you",
	"from",
	"about",
	"with",
]);
export function createScriptedProvider(): Provider {
	return {
		mode: "scripted",
		secret: async () => undefined,
		run: async ({ query, retrieve, emit, signal }) => {
			const evidence = await retrieve(query, signal);
			signal.throwIfAborted();
			emit({ type: "sources", sources: evidence.sources });
			emit({ type: "status", stage: "answering" });
			const terms = (query.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []).filter(
				(term) => !stop.has(term),
			);
			const sentences = evidence.sources
				.flatMap((source) =>
					(source.text.match(/[^.!?]+[.!?]*/g) ?? []).map((text) => ({
						text: text.trim(),
						source,
						score: terms.filter((term) => text.toLowerCase().includes(term))
							.length,
					})),
				)
				.filter(
					(item) => item.score >= Math.min(2, terms.length) && terms.length > 0,
				)
				.sort((a, b) => b.score - a.score)
				.slice(0, 2);
			const answer = sentences.length
				? sentences
						.map(
							({ text, source }) =>
								`${text} [${source.filename}#${source.ordinal}]`,
						)
						.join(" ")
				: "I cannot answer from the available documents.";
			for (const text of answer.match(/.{1,60}/gs) ?? []) {
				signal.throwIfAborted();
				emit({ type: "delta", text });
				await Promise.resolve();
			}
			return { answer, sources: evidence.sources };
		},
	};
}
