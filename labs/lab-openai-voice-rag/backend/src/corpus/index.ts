import type { Logger } from "../logger.js";
import { ingestCorpus } from "./ingest.js";
import { retrieveCorpus } from "./retrieve.js";
import { createStore } from "./store.js";
import type { Embed } from "./types.js";

type Options = {
	databaseUrl: string;
	documentsRoot: string;
	embed: Embed;
	logger: Logger;
	chunkLength?: number;
	topK?: number;
	contextBudget?: number;
	fileBytes?: number;
	totalBytes?: number;
};
function limit(value: number | undefined, fallback: number, max: number) {
	const result = value ?? fallback;
	if (!Number.isSafeInteger(result) || result < 1 || result > max)
		throw new Error("Corpus limit outside allowed range");
	return result;
}
export function createCorpus(options: Options) {
	const chunkLength = limit(options.chunkLength, 800, 10000);
	const topK = limit(options.topK, 5, 50);
	const contextBudget = limit(options.contextBudget, 6000, 50000);
	const fileBytes = limit(options.fileBytes, 262144, 1048576);
	const totalBytes = limit(options.totalBytes, 2097152, 10485760);
	const store = createStore(options.databaseUrl);
	const logger = options.logger.child({ domain: "corpus" });
	let queue: Promise<unknown> = Promise.resolve();
	async function operation<T>(
		name: string,
		fields: Record<string, unknown>,
		work: () => Promise<T>,
	): Promise<T> {
		try {
			logger.info(fields, `${name}...`);
			const result = await work();
			logger.info({ completed: true }, `${name} succeeded.`);
			return result;
		} catch (err) {
			logger.error(
				{ err: new Error(`${name} failed; details withheld`), ...fields },
				`${name} failed.`,
			);
			throw err;
		}
	}
	return {
		migrate: () => operation("Migrate corpus", {}, store.migrate),
		ingest: () => {
			const pending = queue.then(() =>
				operation(
					"Ingest corpus",
					{ documentsRoot: options.documentsRoot },
					() =>
						ingestCorpus({
							store,
							...options,
							chunkLength,
							fileBytes,
							totalBytes,
						}),
				),
			);
			queue = pending.catch(() => {});
			return pending;
		},
		retrieve: (question: string, signal?: AbortSignal) =>
			operation(
				"Retrieve corpus",
				{ questionLength: question.length },
				async () => {
					const evidence = await retrieveCorpus(
						{ store, ...options, topK, contextBudget },
						question,
						signal,
					);
					logger.info(
						{
							sourceCount: evidence.sources.length,
							contextCharacters: evidence.context.length,
						},
						"Retrieve evidence succeeded.",
					);
					return evidence;
				},
			),
		close: async () => {
			await queue;
			await operation("Close corpus", {}, store.close);
		},
	};
}
