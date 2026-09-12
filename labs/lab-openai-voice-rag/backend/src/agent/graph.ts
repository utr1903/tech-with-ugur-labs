import type { Evidence, Source } from "../corpus/types.js";
import { SafeError, safeError } from "../http/errors.js";
import type { Logger } from "../logger.js";
import { logOperation } from "../operation.js";
import type { ManagedSession, Pending, Provider } from "../provider/types.js";
import { createConversations } from "./conversations.js";
import { createTurnDeadline } from "./turn-deadline.js";

type Options = {
	provider: Provider;
	retrieve: (question: string, signal?: AbortSignal) => Promise<Evidence>;
	logger: Logger;
	deadlineMs?: number;
	ttlMs?: number;
	maxSessions?: number;
	now?: () => number;
};
function toolQuestion(call: Pending): string {
	if (
		call.name !== "retrieve_documents" ||
		!call.turnId ||
		!call.callId ||
		!call.arguments ||
		typeof call.arguments !== "object" ||
		!("question" in call.arguments) ||
		typeof call.arguments.question !== "string" ||
		!call.arguments.question.trim() ||
		call.arguments.question.length > 2000
	)
		throw new SafeError("Invalid provider action");
	return call.arguments.question;
}
async function execute(
	session: ManagedSession,
	question: string,
	options: Options,
	signal: AbortSignal,
) {
	let step = await session.turn(question, signal);
	signal.throwIfAborted();
	const seen = new Set<string>();
	const sources = new Map<string, Source>();
	let calls = 0;
	while (step.type === "pending") {
		if (!step.calls.length) throw new SafeError("Invalid provider action");
		const pending = step.calls;
		for (const call of pending) {
			const key = `${call.turnId}:${call.callId}`;
			if (seen.has(key) || ++calls > 4)
				throw new SafeError("Provider tool limit exceeded");
			seen.add(key);
			const evidence = await options.retrieve(toolQuestion(call), signal);
			signal.throwIfAborted();
			for (const source of evidence.sources) sources.set(source.id, source);
			step = await session.output(call, evidence, signal);
			signal.throwIfAborted();
		}
	}
	if (calls === 0) throw new SafeError("Provider skipped retrieval");
	if (!step.answer.trim() || step.answer.length > 12000)
		throw new SafeError("Invalid provider answer");
	return { answer: step.answer, sources: [...sources.values()] };
}
export function createGraph(options: Options) {
	const sessions = createConversations(
		options.provider,
		options.ttlMs ?? 1800000,
		options.maxSessions ?? 100,
		options.now ?? Date.now,
	);
	return {
		create: async () => sessions.create(),
		remove: sessions.remove,
		turn: (id: string, question: string) =>
			logOperation(
				options.logger,
				"Agent turn",
				{ conversationId: id, query: question },
				async () => {
					const item = sessions.get(id);
					const boundary = createTurnDeadline(
						item.controller.signal,
						options.deadlineMs ?? 30000,
					);
					const work = item.queue
						.then(() => {
							if (item.closed || sessions.get(id) !== item)
								throw new SafeError("Unknown conversation", 404);
							boundary.signal.throwIfAborted();
							return execute(item.session, question, options, boundary.signal);
						})
						.catch((err) => {
							const safe = safeError(err);
							sessions.remove(id, safe);
							throw safe;
						});

					item.queue = work.catch(() => {});
					try {
						const result = await Promise.race([work, boundary.cancelled]);
						return result;
					} catch (err) {
						sessions.remove(id);
						const safe = safeError(err);
						throw safe;
					} finally {
						boundary.close();
					}
				},
				(result) => ({
					sourceCount: result.sources.length,
					answerCharacters: result.answer.length,
				}),
			),
	};
}
