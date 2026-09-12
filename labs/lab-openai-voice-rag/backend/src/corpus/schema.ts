import {
	integer,
	pgTable,
	text,
	uniqueIndex,
	vector,
} from "drizzle-orm/pg-core";
export const documents = pgTable("documents", {
	filename: text("filename").primaryKey(),
	hash: text("hash").notNull(),
	embeddingFingerprint: text("embedding_fingerprint"),
});
export const chunks = pgTable(
	"chunks",
	{
		id: text("id").primaryKey(),
		filename: text("filename")
			.notNull()
			.references(() => documents.filename, { onDelete: "cascade" }),
		ordinal: integer("ordinal").notNull(),
		text: text("text").notNull(),
		embedding: vector("embedding", { dimensions: 1536 }).notNull(),
	},
	(table) => [
		uniqueIndex("chunk_document_ordinal").on(table.filename, table.ordinal),
	],
);

export { chats, turns } from "../chat/schema.js";
