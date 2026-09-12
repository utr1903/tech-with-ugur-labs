import { randomUUID } from "node:crypto";
import type { Provider } from "./types.js";
export function createScriptedProvider(): Provider {
	return {
		mode: "scripted",
		secret: async () => undefined,
		create: () => {
			let question = "";
			return {
				close: () => {},
				turn: async (text) => {
					question = text;
					return {
						type: "pending",
						calls: [
							{
								turnId: randomUUID(),
								callId: randomUUID(),
								name: "retrieve_documents",
								arguments: { question: text },
							},
						],
					};
				},
				output: async (_call, evidence) => {
					const terms = question.toLowerCase().match(/[a-z0-9]{3,}/g) ?? [];
					const relevant = evidence.sources.filter(
						(source) =>
							terms.filter((term) => source.text.toLowerCase().includes(term))
								.length >= Math.min(2, terms.length) && terms.length > 0,
					);
					return {
						type: "final",
						answer: relevant.length
							? relevant
									.map(
										(source) =>
											`[${source.filename}#${source.ordinal}] ${source.text}`,
									)
									.join("\n")
							: "I cannot answer from the available documents.",
					};
				},
			};
		},
	};
}
