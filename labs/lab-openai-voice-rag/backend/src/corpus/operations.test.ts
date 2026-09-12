import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pino from "pino";
import { expect, it } from "vitest";
import { ingestCorpus } from "./ingest.js";
import { retrieveCorpus } from "./retrieve.js";
import { scriptedEmbed } from "./scripted-embed.js";
import type { Store } from "./store.js";

it("logs the inner chunk failure before embedding and rethrows it safely", async () => {
	const root = await mkdtemp(join(tmpdir(), "chunk-logs-"));
	const lines: string[] = [];
	const logger = pino(
		{},
		{
			write: (line) => {
				lines.push(line);
			},
		},
	);
	const store = {
		db: { select: () => ({ from: async () => [] }) },
	} as unknown as Store;
	try {
		await writeFile(join(root, "sample.md"), "private-document-text");
		await expect(
			ingestCorpus({
				store,
				logger,
				documentsRoot: root,
				embed: scriptedEmbed,
				embeddingFingerprint: "test",
				chunkLength: 0,
				fileBytes: 1000,
				totalBytes: 1000,
			}),
		).rejects.toThrow("Invalid chunk length");
		expect(lines.map((line) => JSON.parse(line).msg)).toEqual([
			"Chunk documents...",
			"Chunk documents failed.",
		]);
		expect(lines.join("")).not.toContain("private-document-text");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

it("logs database search failure after a valid embedding without provider details", async () => {
	const lines: string[] = [];
	const logger = pino(
		{},
		{
			write: (line) => {
				lines.push(line);
			},
		},
	);
	const failure = new Error("private-database-detail");
	const store = {
		db: {
			transaction: async () => {
				throw failure;
			},
		},
	} as unknown as Store;
	await expect(
		retrieveCorpus(
			{ store, embed: scriptedEmbed, logger, topK: 1, contextBudget: 100 },
			"owner query",
		),
	).rejects.toBe(failure);
	const entries = lines.map((line) => JSON.parse(line));
	expect(entries.map((entry) => entry.msg)).toEqual([
		"Search relevant chunks...",
		"Search relevant chunks failed.",
	]);
	expect(entries[1]).toMatchObject({
		query: "owner query",
		durationMs: expect.any(Number),
	});
	expect(lines.join("")).not.toContain("private-database-detail");
});
