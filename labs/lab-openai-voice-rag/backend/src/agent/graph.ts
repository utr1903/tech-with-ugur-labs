import { createQueue } from "../chat/queue.js";
import type { ChatStore } from "../chat/store.js";
import type { Evidence } from "../corpus/types.js";
import { SafeError, safeError } from "../http/errors.js";
import type { Logger } from "../logger.js";
import { logOperation } from "../operation.js";
import type { AgentEvent, Provider } from "../provider/types.js";
import { createTurnDeadline } from "./turn-deadline.js";

type Options = {
	provider: Provider;
	chats: ChatStore;
	retrieve: (question: string, signal?: AbortSignal) => Promise<Evidence>;
	logger: Logger;
	deadlineMs?: number;
	maxChats?: number;
	maxPending?: number;
};
async function checkedRetrieval(
	options: Options,
	question: string,
	signal: AbortSignal,
) {
	const evidence = await options.retrieve(question, signal);
	signal.throwIfAborted();
	return evidence;
}
function checkedEmit(
	signal: AbortSignal,
	emit: (event: AgentEvent) => void,
	event: AgentEvent,
) {
	signal.throwIfAborted();
	emit(event);
}
async function execute(
	options: Options,
	sessionId: string,
	query: string,
	emit: (event: AgentEvent) => void,
	boundary: ReturnType<typeof createTurnDeadline>,
) {
	let id: number | undefined;
	const signal = boundary.signal;
	try {
		signal.throwIfAborted();
		id = await options.chats.begin(sessionId, query);
		signal.throwIfAborted();
		const history = await options.chats.history(sessionId);
		signal.throwIfAborted();
		emit({ type: "status", stage: "searching" });
		const result = await Promise.race([
			options.provider.run({
				history,
				query,
				retrieve: (question, signal) =>
					checkedRetrieval(options, question, signal),
				emit: (event) => checkedEmit(signal, emit, event),
				signal,
			}),
			boundary.cancelled,
		]);
		signal.throwIfAborted();
		if (!result.answer.trim() || result.answer.length > 12000)
			throw new SafeError("Invalid provider answer");
		await options.chats.complete(id, result);
		signal.throwIfAborted();
		emit({ type: "done", ...result });
		return result;
	} catch (err) {
		if (id !== undefined)
			await options.chats.fail(id, signal.aborted ? "cancelled" : "failed");
		throw safeError(err);
	}
}
export function createGraph(options: Options) {
	const enqueue = createQueue(options.maxChats, options.maxPending);
	return {
		turn: (
			sessionId: string,
			query: string,
			emit: (event: AgentEvent) => void,
			lifecycle: AbortSignal,
		) => {
			const boundary = createTurnDeadline(
				lifecycle,
				options.deadlineMs ?? 30000,
			);
			let work: Promise<unknown>;
			try {
				work = enqueue(sessionId, boundary.signal, () =>
					logOperation(
						options.logger,
						"Agent turn",
						{ sessionId, query },
						() => execute(options, sessionId, query, emit, boundary),
						(result) => ({
							sourceCount: result.sources.length,
							answerCharacters: result.answer.length,
						}),
					),
				);
			} catch (err) {
				boundary.close();
				throw err;
			}
			return Promise.race([work, boundary.cancelled]).finally(() =>
				boundary.close(),
			);
		},
	};
}
