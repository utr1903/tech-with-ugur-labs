import { createHash } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { chunkText } from "./chunk.js";
import { readDocuments } from "./files.js";
import { chunks, documents } from "./schema.js";
import type { Store } from "./store.js";
import type { Embed, Refresh } from "./types.js";
import { validateVectors } from "./vectors.js";

type Options = {
	store: Store;
	documentsRoot: string;
	embed: Embed;
	chunkLength: number;
	fileBytes: number;
	totalBytes: number;
};
async function stageChanges(options: Options, existing: Map<string, string>) {
	const files = await readDocuments(options.documentsRoot, options);
	const changed = files.filter(
		(file) => existing.get(file.filename) !== file.hash,
	);
	const texts = changed.flatMap((file) =>
		chunkText(file.text, options.chunkLength),
	);
	const vectors = texts.length ? await options.embed(texts) : [];
	validateVectors(vectors, texts.length);
	let position = 0;
	const staged = changed.map((file) => ({
		file,
		rows: chunkText(file.text, options.chunkLength).map((text, ordinal) => {
			const embedding = vectors[position++];
			if (!embedding) throw new Error("Missing staged embedding");
			return {
				id: createHash("sha256")
					.update(`${file.filename}\0${file.hash}\0${ordinal}`)
					.digest("hex"),
				filename: file.filename,
				ordinal,
				text,
				embedding,
			};
		}),
	}));
	return { files, staged };
}
export async function ingestCorpus(options: Options): Promise<Refresh> {
	const existing = new Map(
		(await options.store.db.select().from(documents)).map((file) => [
			file.filename,
			file.hash,
		]),
	);
	const { files, staged } = await stageChanges(options, existing);
	const filenames = new Set(files.map((file) => file.filename));
	const deleted = [...existing.keys()].filter(
		(filename) => !filenames.has(filename),
	);
	await options.store.db.transaction(async (tx) => {
		if (deleted.length)
			await tx.delete(documents).where(inArray(documents.filename, deleted));
		for (const { file, rows } of staged) {
			await tx.delete(chunks).where(eq(chunks.filename, file.filename));
			await tx
				.insert(documents)
				.values({ filename: file.filename, hash: file.hash })
				.onConflictDoUpdate({
					target: documents.filename,
					set: { hash: file.hash },
				});
			if (rows.length) await tx.insert(chunks).values(rows);
		}
	});
	const added = staged.filter(
		({ file }) => !existing.has(file.filename),
	).length;
	return {
		added,
		changed: staged.length - added,
		deleted: deleted.length,
		unchanged: files.length - staged.length,
	};
}
