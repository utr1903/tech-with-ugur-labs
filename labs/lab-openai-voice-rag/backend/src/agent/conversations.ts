import { randomUUID } from "node:crypto";
import { SafeError } from "../http/errors.js";
import type { ManagedSession, Provider } from "../provider/types.js";
export type Conversation = {
	session: ManagedSession;
	expires: number;
	queue: Promise<unknown>;
};
export function createConversations(
	provider: Provider,
	ttl: number,
	max: number,
	now: () => number,
) {
	const sessions = new Map<string, Conversation>();
	function prune() {
		for (const [id, item] of sessions)
			if (item.expires <= now()) {
				item.session.close();
				sessions.delete(id);
			}
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
			});
			return id;
		},
		get(id: string) {
			prune();
			const item = sessions.get(id);
			if (!item) throw new SafeError("Unknown conversation", 404);
			return item;
		},
		remove(id: string) {
			sessions.get(id)?.session.close();
			sessions.delete(id);
		},
	};
}
