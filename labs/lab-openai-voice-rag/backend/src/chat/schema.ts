import {
	index,
	jsonb,
	pgTable,
	serial,
	text,
	timestamp,
	uuid,
} from "drizzle-orm/pg-core";
import type { Source } from "../corpus/types.js";
export const chats = pgTable("chats", {
	id: uuid("id").primaryKey(),
	createdAt: timestamp("created_at", { withTimezone: true })
		.defaultNow()
		.notNull(),
});
export const turns = pgTable(
	"chat_turns",
	{
		id: serial("id").primaryKey(),
		chatId: uuid("chat_id")
			.notNull()
			.references(() => chats.id),
		query: text("query").notNull(),
		status: text("status").notNull(),
		answer: text("answer"),
		sources: jsonb("sources").$type<Source[]>(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		index("chat_completed_history").on(table.chatId, table.status, table.id),
	],
);
