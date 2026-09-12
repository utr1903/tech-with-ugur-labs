import type { Evidence, Source } from "../corpus/types.js";
import { SafeError, safeError } from "../http/errors.js";
import type { Logger } from "../logger.js";
import type { ManagedSession, Pending, Provider } from "../provider/types.js";
import { createConversations } from "./conversations.js";

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
		turn: async (id: string, question: string) => {
			const item = sessions.get(id);
			const controller = new AbortController();
			let timer: ReturnType<typeof setTimeout> | undefined;
			const timeout = new Promise<never>((_resolve, reject) => {
				timer = setTimeout(() => {
					controller.abort();
					sessions.remove(id);
					reject(new SafeError("Turn deadline exceeded", 504));
				}, options.deadlineMs ?? 30000);
			});
			const work = item.queue.then(() => {
				controller.signal.throwIfAborted();
				options.logger.info(
					{ conversationId: id, questionLength: question.length },
					"Agent turn...",
				);
				return execute(item.session, question, options, controller.signal);
			});
			item.queue = work.catch(() => {});
			try {
				const result = await Promise.race([work, timeout]);
				options.logger.info(
					{ sourceCount: result.sources.length },
					"Agent turn succeeded.",
				);
				return result;
			} catch (err) {
				sessions.remove(id);
				const safe = safeError(err);
				options.logger.error({ err: safe }, "Agent turn failed.");
				throw safe;
			} finally {
				clearTimeout(timer);
			}
		},
	};
}
