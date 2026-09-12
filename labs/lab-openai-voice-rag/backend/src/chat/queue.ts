import { SafeError } from "../http/errors.js";
export function createQueue(maxChats = 100, maxPending = 4) {
	const chats = new Map<string, { tail: Promise<unknown>; count: number }>();
	return function enqueue<T>(
		id: string,
		signal: AbortSignal,
		work: () => Promise<T>,
	): Promise<T> {
		let item = chats.get(id);
		if (!item) {
			if (chats.size >= maxChats)
				throw new SafeError("Agent capacity reached", 429);
			item = { tail: Promise.resolve(), count: 0 };
			chats.set(id, item);
		}
		if (item.count >= maxPending)
			throw new SafeError("Chat queue capacity reached", 429);
		item.count++;
		const current = item;
		const result = current.tail.then(async () => {
			signal.throwIfAborted();
			return work();
		});
		current.tail = result
			.catch(() => {})
			.finally(() => {
				current.count--;
				if (current.count === 0) chats.delete(id);
			});
		return result;
	};
}
