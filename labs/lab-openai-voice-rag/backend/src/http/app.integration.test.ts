import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { createChatStore } from "../chat/store.js";
import { createCorpus } from "../corpus/index.js";
import {
	scriptedEmbed,
	scriptedEmbeddingIdentity,
} from "../corpus/scripted-embed.js";
import { createStore } from "../corpus/store.js";
import { createLogger } from "../logger.js";
import { createScriptedProvider } from "../provider/scripted.js";
import { createApp } from "./app.js";

const url = process.env.TEST_DATABASE_URL;
if (!url || new URL(url).pathname !== "/voice_rag_test")
	throw Error("Dedicated test database required");
const logger = createLogger({ appName: "stream-test" });
logger.level = "silent";
const evidence = {
	sources: [
		{
			id: "amber",
			filename: "amber.md",
			ordinal: 0,
			text: "The amber valve recovery code is ORCHID-47.",
		},
	],
	context: "amber",
};
it("streams early deltas, persists before done and isolates explicit completed history", async () => {
	const db = createStore(url);
	await db.migrate();
	const chats = createChatStore(db, logger);
	const seen: unknown[] = [];
	let release = () => {};
	const held = new Promise<void>((r) => {
		release = r;
	});
	const provider = createScriptedProvider();
	let count = 0;
	provider.run = async ({ history, query, retrieve, emit, signal }) => {
		seen.push(history);
		const e = await retrieve(query, signal);
		emit({ type: "sources", sources: e.sources });
		emit({ type: "delta", text: "Answer." });
		if (++count === 1) await held;
		return { answer: "Answer.", sources: e.sources };
	};
	const corpus = {
		retrieve: async () => evidence,
		ingest: async () => ({ added: 0, changed: 0, deleted: 0, unchanged: 0 }),
	};
	const app = createApp({ corpus, provider, chats, logger });
	const id = randomUUID();
	const request = (sessionId: string) =>
		app.request("/api/agent", {
			method: "POST",
			body: JSON.stringify({ sessionId, query: "amber valve" }),
		});
	try {
		const response = await request(id);
		expect(response.headers.get("content-type")).toContain(
			"application/x-ndjson",
		);
		const reader = response.body?.getReader();
		if (!reader) throw Error("Response stream missing");
		let text = "";
		while (!text.includes('"type":"delta"'))
			text += new TextDecoder().decode((await reader.read()).value);
		expect(text).not.toContain('"type":"done"');
		expect(await chats.history(id)).toEqual([]);
		release();
		while (true) {
			const item = await reader.read();
			if (item.done) break;
			text += new TextDecoder().decode(item.value);
		}
		expect(text).toContain('"type":"done"');
		expect(await chats.history(id)).toEqual([
			{ role: "user", content: "amber valve" },
			{ role: "assistant", content: "Answer." },
		]);
		await (await request(id)).text();
		await (await request(randomUUID())).text();
		expect(seen).toEqual([
			[],
			[
				{ role: "user", content: "amber valve" },
				{ role: "assistant", content: "Answer." },
			],
			[],
		]);
	} finally {
		release();
		await db.close();
	}
});
it("answers through HTTP from actual persisted corpus and refreshes changed evidence", async () => {
	const root = await mkdtemp(join(tmpdir(), "stream-corpus-"));
	const db = createStore(url);
	const corpus = createCorpus({
		databaseUrl: url,
		documentsRoot: root,
		embed: scriptedEmbed,
		embeddingIdentity: scriptedEmbeddingIdentity,
		logger,
	});
	try {
		await corpus.migrate();
		await writeFile(
			join(root, "amber.md"),
			"The amber valve recovery code is ORCHID-47.",
		);
		await corpus.ingest();
		const chats = createChatStore(db, logger);
		const app = createApp({
			corpus,
			chats,
			provider: createScriptedProvider(),
			logger,
		});
		const sessionId = randomUUID();
		const request = () =>
			app.request("/api/agent", {
				method: "POST",
				body: JSON.stringify({
					sessionId,
					query: "What is the amber valve recovery code?",
				}),
			});
		const text = await (await request()).text();
		expect(text).toContain("ORCHID-47");
		expect(text).toContain('"filename":"amber.md"');
		await writeFile(
			join(root, "amber.md"),
			"The amber valve recovery code is LILY-22.",
		);
		expect(
			await (await app.request("/api/ingest", { method: "POST" })).json(),
		).toMatchObject({ changed: 1 });
		const updated = await (await request()).text();
		expect(updated).toContain("LILY-22");
		expect(updated).not.toContain("ORCHID-47");
	} finally {
		await corpus.close();
		await db.close();
		await rm(root, { recursive: true, force: true });
	}
});
