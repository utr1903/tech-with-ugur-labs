import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterAll, beforeAll, expect, test } from "vitest";
import { createLogger } from "../logger.js";
import { createCorpus } from "./index.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl || !new URL(databaseUrl).pathname.endsWith("/voice_rag_test"))
	throw Error("Use dedicated voice_rag_test TEST_DATABASE_URL");
const pool = new pg.Pool({ connectionString: databaseUrl });
const db = drizzle(pool);
const logger = createLogger({ appName: "identity-test" });
logger.level = "silent";
const text = "The amber valve recovery code is ORCHID-47.";
let documentsRoot: string;
let corpus: ReturnType<typeof createCorpus>;
const embedded: string[][] = [];
async function select(
	provider: string,
	fail = false,
	chunkLength = 800,
	model = "test-v1",
) {
	await corpus?.close();
	corpus = createCorpus({
		databaseUrl: databaseUrl as string,
		documentsRoot,
		logger,
		chunkLength,
		embeddingIdentity: { provider, model, dimensions: 1536 },
		embed: async (texts) => {
			embedded.push(texts);
			if (fail) throw Error("Embedding unavailable");
			return texts.map(() =>
				Array.from({ length: 1536 }, (_, i) =>
					i === (provider === "A" ? 0 : 1) ? 1 : 0,
				),
			);
		},
	});
}
async function snapshot() {
	return (
		await db.execute(
			sql`SELECT d.*, c.embedding::text AS vector FROM documents d JOIN chunks c USING (filename) ORDER BY c.ordinal`,
		)
	).rows;
}
beforeAll(async () => {
	documentsRoot = await mkdtemp(join(tmpdir(), "identity-"));
	await db.execute(sql`DROP SCHEMA public CASCADE`);
	await db.execute(sql`CREATE SCHEMA public`);
	await db.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`);
	await writeFile(join(documentsRoot, "handbook.md"), text);
	await select("A");
	await corpus.migrate();
});
afterAll(async () => {
	await corpus.close();
	await pool.end();
	await rm(documentsRoot, { recursive: true, force: true });
});
test("unchanged text re-embeds on forward and reverse provider switches and then skips", async () => {
	await corpus.ingest();
	const original = await snapshot();
	for (const provider of ["B", "A"]) {
		await select(provider);
		embedded.length = 0;
		expect(await corpus.ingest()).toMatchObject({ changed: 1, unchanged: 0 });
		expect(embedded).toEqual([[text]]);
		const stored = await snapshot();
		expect(stored[0]?.hash).toBe(
			createHash("sha256").update(text).digest("hex"),
		);
		if (provider === "B")
			expect(stored[0]?.vector).not.toBe(original[0]?.vector);
		else expect(stored).toEqual(original);
		expect(await corpus.ingest()).toMatchObject({ unchanged: 1 });
		expect(embedded).toHaveLength(1);
	}
});
test("failed identity regeneration preserves old vectors and metadata and retries", async () => {
	await select("A");
	await corpus.ingest();
	const old = await snapshot();
	await select("B", true);
	await expect(corpus.ingest()).rejects.toThrow("Embedding unavailable");
	expect(await snapshot()).toEqual(old);
	await select("B");
	expect(await corpus.ingest()).toMatchObject({ changed: 1 });
	expect(await snapshot()).not.toEqual(old);
});
test("legacy identity and changed chunk length rebuild unchanged content", async () => {
	await select("A");
	await corpus.ingest();
	await db.execute(sql`UPDATE documents SET embedding_fingerprint = NULL`);
	expect(await corpus.ingest()).toMatchObject({ changed: 1 });
	await select("A", false, 20);
	embedded.length = 0;
	expect(await corpus.ingest()).toMatchObject({ changed: 1 });
	expect(embedded[0]?.join("")).toBe(text);
	expect((await snapshot()).length).toBe(3);
	expect(await corpus.ingest()).toMatchObject({ unchanged: 1 });
});
test("database insertion failure rolls back fingerprint with replacement vectors", async () => {
	await select("A");
	await corpus.ingest();
	const old = await snapshot();
	await db.execute(
		sql`ALTER TABLE chunks ADD CONSTRAINT reject_new CHECK (false) NOT VALID`,
	);
	try {
		await select("B");
		await expect(corpus.ingest()).rejects.toThrow();
		expect(await snapshot()).toEqual(old);
	} finally {
		await db.execute(sql`ALTER TABLE chunks DROP CONSTRAINT reject_new`);
	}
	expect(await corpus.ingest()).toMatchObject({ changed: 1 });
	expect(await snapshot()).not.toEqual(old);
});

test("a model change within the same provider regenerates unchanged text", async () => {
	await select("A");
	await corpus.ingest();
	await select("A", false, 800, "test-v2");
	embedded.length = 0;
	expect(await corpus.ingest()).toMatchObject({ changed: 1 });
	expect(embedded).toEqual([[text]]);
	expect(await corpus.ingest()).toMatchObject({ unchanged: 1 });
});
