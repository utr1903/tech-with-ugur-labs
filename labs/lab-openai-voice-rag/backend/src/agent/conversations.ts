import { randomUUID } from "node:crypto";
import { SafeError } from "../http/errors.js";
import type { ManagedSession, Provider } from "../provider/types.js";
export type Conversation = {
	session: ManagedSession;
	expires: number;
	queue: Promise<unknown>;
	closed: boolean;
	controller: AbortController;
};
export function createConversations(
	provider: Provider,
	ttl: number,
	max: number,
	now: () => number,
) {
	const sessions = new Map<string, Conversation>();
	function remove(
		id: string,
		reason = new SafeError("Unknown conversation", 404),
	) {
		const item = sessions.get(id);
		if (!item) return;
		sessions.delete(id);
		item.closed = true;
		item.controller.abort(reason);
		item.session.close();
	}
	function prune() {
		for (const [id, item] of sessions) if (item.expires <= now()) remove(id);
	}

	return {
		create() {
			prune();
			if (sessions.size >= max)
				throw new SafeError("Conversation capacity reached", 429);
			const id = randomUUID();
			sessions.set(id, {
				session: provider.create(),
				expires: now() + ttl,
				queue: Promise.resolve(),
				closed: false,
				controller: new AbortController(),
			});
			return id;
		},
		get(id: string) {
			prune();
			const item = sessions.get(id);
			if (!item) throw new SafeError("Unknown conversation", 404);
			return item;
		},
		remove,
	};
}
