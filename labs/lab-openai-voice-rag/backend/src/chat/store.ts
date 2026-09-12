import { and, desc, eq } from "drizzle-orm";
import type { Store } from "../corpus/store.js";
import type { Logger } from "../logger.js";
import { logOperation } from "../operation.js";
import type { Answer } from "../provider/types.js";
import { boundedHistory } from "./history.js";
import { chats, turns } from "./schema.js";
export function createChatStore(store: Store, logger: Logger) {
	return {
		begin: (sessionId: string, query: string) =>
			logOperation(
				logger,
				"Persist human turn",
				{ sessionId, query },
				async () =>
					store.db.transaction(async (db) => {
						await db
							.insert(chats)
							.values({ id: sessionId })
							.onConflictDoNothing();
						const [row] = await db
							.insert(turns)
							.values({ chatId: sessionId, query, status: "pending" })
							.returning({ id: turns.id });
						if (!row) throw Error("Turn not created");
						return row.id;
					}),
				(id) => ({ turnId: id }),
			),
		history: (sessionId: string) =>
			logOperation(
				logger,
				"Load completed history",
				{ sessionId },
				async () =>
					boundedHistory(
						await store.db
							.select({ query: turns.query, answer: turns.answer })
							.from(turns)
							.where(
								and(eq(turns.chatId, sessionId), eq(turns.status, "completed")),
							)
							.orderBy(desc(turns.id))
							.limit(20),
					),
				(history) => ({ messageCount: history.length }),
			),
		complete: (id: number, result: Answer) =>
			logOperation(
				logger,
				"Persist assistant turn",
				{ turnId: id },
				async () => {
					await store.db
						.update(turns)
						.set({ ...result, status: "completed" })
						.where(eq(turns.id, id));
				},
				() => ({
					sourceCount: result.sources.length,
					answerCharacters: result.answer.length,
				}),
			),
		fail: (id: number, status: "failed" | "cancelled") =>
			logOperation(
				logger,
				"Persist unsuccessful turn",
				{ turnId: id, status },
				async () => {
					await store.db.update(turns).set({ status }).where(eq(turns.id, id));
				},
				() => ({}),
			),
	};
}
export type ChatStore = ReturnType<typeof createChatStore>;
