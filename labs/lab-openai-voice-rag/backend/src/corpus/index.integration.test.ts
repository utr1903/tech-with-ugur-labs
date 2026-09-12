import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterAll, beforeAll, expect, test } from "vitest";
import { createLogger } from "../logger.js";
import { createCorpus } from "./index.js";
import { scriptedEmbed, scriptedEmbeddingIdentity } from "./scripted-embed.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl || !new URL(databaseUrl).pathname.endsWith("/voice_rag_test"))
	throw new Error("Use dedicated voice_rag_test TEST_DATABASE_URL");
const pool = new pg.Pool({ connectionString: databaseUrl });
const db = drizzle(pool);
const logger = createLogger({ appName: "corpus-test" });
logger.level = "silent";
let documentsRoot: string;
let corpus: ReturnType<typeof createCorpus>;
beforeAll(async () => {
	documentsRoot = await mkdtemp(join(tmpdir(), "integration-"));
	await db.execute(sql`DROP SCHEMA public CASCADE`);
	await db.execute(sql`CREATE SCHEMA public`);
	await db.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`);
	corpus = createCorpus({
		embeddingIdentity: scriptedEmbeddingIdentity,
		databaseUrl,
		documentsRoot,
		embed: scriptedEmbed,
		logger,
		chunkLength: 80,
		topK: 1,
		contextBudget: 800,
	});
	await corpus.migrate();
});
afterAll(async () => {
	await corpus.close();
	await pool.end();
	await rm(documentsRoot, { recursive: true, force: true });
});
test("persists, refreshes atomically and retrieves the adjacent recovery code", async () => {
	await writeFile(
		join(documentsRoot, "handbook.md"),
		`${"The amber valve recovery code is described in the next section. ".padEnd(
			80,
			" ",
		)}ORCHID-47 is the fictional recovery code.`,
	);
	expect(await corpus.ingest()).toMatchObject({ added: 1 });
	expect(await corpus.ingest()).toMatchObject({ unchanged: 1 });
	let result = await corpus.retrieve("What is the amber valve recovery code?");
	expect(result.context).toContain("ORCHID-47");
	expect(new Set(result.sources.map((s) => s.id)).size).toBe(
		result.sources.length,
	);
	expect(result.sources.every((s) => s.filename === "handbook.md")).toBe(true);
	expect(result.sources.map((s) => s.ordinal)).toEqual([0, 1]);
	await corpus.close();
	corpus = createCorpus({
		embeddingIdentity: scriptedEmbeddingIdentity,
		databaseUrl,
		documentsRoot,
		embed: scriptedEmbed,
		logger,
	});
	expect((await corpus.retrieve("amber valve")).context).toContain("ORCHID-47");
	await writeFile(join(documentsRoot, "handbook.md"), "amber valve NEW-CODE");
	expect(await corpus.ingest()).toMatchObject({ changed: 1 });
	result = await corpus.retrieve("amber valve");
	expect(result.context).toContain("NEW-CODE");
	expect(result.context).not.toContain("ORCHID-47");
	await rm(join(documentsRoot, "handbook.md"));
	expect(await corpus.ingest()).toMatchObject({ deleted: 1 });
	expect((await corpus.retrieve("amber valve")).sources).toEqual([]);
});
test("installs vector extension and rejects malformed vectors without altering stored corpus", async () => {
	const extension = await db.execute(
		sql`SELECT extname FROM pg_extension WHERE extname='vector'`,
	);
	expect(extension.rows).toHaveLength(1);
	await writeFile(
		join(documentsRoot, "handbook.md"),
		"amber valve stable corpus",
	);
	await corpus.ingest();
	const dimensions = await db.execute(
		sql`SELECT vector_dims(embedding) AS dimensions FROM chunks`,
	);
	expect(dimensions.rows).toEqual([{ dimensions: 1536 }]);
	await writeFile(join(documentsRoot, "handbook.md"), "changed text");
	for (const embed of [
		async () => [[1, 2]],
		async () => [Array(1536).fill(Number.NaN)],
		async () => {
			throw new Error("provider failed");
		},
	]) {
		const failing = createCorpus({
			embeddingIdentity: scriptedEmbeddingIdentity,
			databaseUrl,
			documentsRoot,
			embed,
			logger,
		});
		await expect(failing.ingest()).rejects.toThrow();
		await failing.close();
		expect((await corpus.retrieve("amber valve")).context).toContain(
			"stable corpus",
		);
	}
});
test("rolls back all replacements and deletions on a database insertion failure", async () => {
	await writeFile(join(documentsRoot, "extra.md"), "temporary entry");
	await corpus.ingest();
	await db.execute(
		sql`ALTER TABLE chunks ADD CONSTRAINT reject_marker CHECK (text NOT LIKE '%REJECT_MARKER%')`,
	);
	await rm(join(documentsRoot, "extra.md"));
	await writeFile(join(documentsRoot, "handbook.md"), "REJECT_MARKER");
	await expect(corpus.ingest()).rejects.toThrow();
	expect(
		(await db.execute(sql`SELECT filename FROM documents ORDER BY filename`))
			.rows,
	).toEqual([{ filename: "extra.md" }, { filename: "handbook.md" }]);
	expect((await corpus.retrieve("amber valve")).context).toContain(
		"changed text",
	);
	await db.execute(sql`ALTER TABLE chunks DROP CONSTRAINT reject_marker`);
});
test("serializes refreshes and bounds citation-bearing context", async () => {
	await writeFile(
		join(documentsRoot, "handbook.md"),
		`amber valve ${"neighbor content ".repeat(30)}`,
	);
	const updates = await Promise.all([corpus.ingest(), corpus.ingest()]);
	expect(updates[0]).toMatchObject({ changed: 1 });
	expect(updates[1]).toMatchObject({ unchanged: 1 });
	const bounded = createCorpus({
		embeddingIdentity: scriptedEmbeddingIdentity,
		databaseUrl,
		documentsRoot,
		embed: scriptedEmbed,
		logger,
		contextBudget: 100,
		topK: 3,
	});
	const result = await bounded.retrieve("amber valve");
	expect(result.context.length).toBeLessThanOrEqual(100);
	expect(result.sources.length).toBeGreaterThan(0);
	await bounded.close();
});
test("keeps provider error contents out of corpus logs while preserving rejection", async () => {
	const { default: pino } = await import("pino");
	const logs: string[] = [];
	const safeLogger = pino(
		{ level: "info" },
		{
			write: (chunk) => {
				logs.push(chunk);
			},
		},
	);
	await writeFile(
		join(documentsRoot, "handbook.md"),
		"edited for provider failure",
	);
	const failing = createCorpus({
		embeddingIdentity: scriptedEmbeddingIdentity,
		databaseUrl,
		documentsRoot,
		logger: safeLogger,
		embed: async () => {
			throw new Error("provider sk-demo-secret");
		},
	});
	await expect(failing.ingest()).rejects.toThrow("provider sk-demo-secret");
	await failing.close();
	expect(logs.join("")).not.toContain("sk-demo-secret");
	expect(logs.join("")).toContain("Ingest corpus failed.");
});
