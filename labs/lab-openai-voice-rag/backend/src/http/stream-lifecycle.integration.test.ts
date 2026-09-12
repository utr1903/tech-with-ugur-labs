import { randomUUID } from "node:crypto";
import { serve } from "@hono/node-server";
import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { createChatStore } from "../chat/store.js";
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
it("excludes partial failed and disconnected turns from completed history", async () => {
	const db = createStore(url);
	await db.migrate();
	const chats = createChatStore(db, logger);
	const provider = createScriptedProvider();
	let cancelObserved = false;
	provider.run = async ({ emit, query, signal }) => {
		emit({ type: "delta", text: "partial" });
		if (query === "fail") throw Error("YOUR_OPENAI_API_KEY");
		await new Promise<void>((_, reject) =>
			signal.addEventListener(
				"abort",
				() => {
					cancelObserved = true;
					reject(signal.reason);
				},
				{ once: true },
			),
		);
		return { answer: "partial", sources: [] };
	};
	const app = createApp({
		corpus: {
			retrieve: async () => evidence,
			ingest: async () => ({ added: 0, changed: 0, deleted: 0, unchanged: 0 }),
		},
		provider,
		chats,
		logger,
	});
	try {
		const id = randomUUID();
		const request = (query: string) =>
			app.request("/api/agent", {
				method: "POST",
				body: JSON.stringify({ sessionId: id, query }),
			});
		const failure = await (await request("fail")).text();
		expect(failure).toContain('"type":"error"');
		expect(failure).not.toContain("YOUR_OPENAI_API_KEY");
		expect(await chats.history(id)).toEqual([]);
		const response = await request("cancel");
		const reader = response.body?.getReader();
		if (!reader) throw Error("Response stream missing");
		await reader.read();
		await reader.cancel();
		await new Promise((r) => setTimeout(r, 30));
		expect(cancelObserved).toBe(true);
		expect(await chats.history(id)).toEqual([]);
	} finally {
		await db.close();
	}
});

it("shares chat capacity across UUID casing and never emits done after persistence fails", async () => {
	const db = createStore(url);
	await db.migrate();
	const chats = createChatStore(db, logger);
	const provider = createScriptedProvider();
	let release = () => {};
	const held = new Promise<void>((r) => {
		release = r;
	});
	let providerRuns = 0;
	let markStarted = () => {};
	const started = new Promise<void>((resolve) => {
		markStarted = resolve;
	});
	provider.run = async () => {
		providerRuns++;
		markStarted();
		await held;
		return { answer: "answer", sources: [] };
	};
	const app = createApp({
		corpus: {
			retrieve: async () => evidence,
			ingest: async () => ({ added: 0, changed: 0, deleted: 0, unchanged: 0 }),
		},
		provider,
		chats,
		logger,
		maxPending: 1,
	});
	const id = randomUUID();
	const request = (sessionId: string = id) =>
		app.request("/api/agent", {
			method: "POST",
			body: JSON.stringify({ sessionId, query: "amber" }),
		});
	try {
		const first = await request();
		await started;
		const second = await request(id.toUpperCase());
		expect(second.status).toBe(429);
		expect(providerRuns).toBe(1);
		release();
		await first.text();
		chats.complete = async () => {
			throw Error("storage write failed");
		};
		const text = await (await request()).text();
		expect(text).toContain('"type":"error"');
		expect(text).not.toContain('"type":"done"');
	} finally {
		release();
		await db.close();
	}
});

it("cancels an actual HTTP provider stream when the browser disconnects", async () => {
	const db = createStore(url);
	await db.migrate();
	const chats = createChatStore(db, logger);
	const provider = createScriptedProvider();
	let observed = () => {};
	const aborted = new Promise<void>((r) => {
		observed = r;
	});
	provider.run = async ({ emit, signal }) => {
		emit({ type: "sources", sources: [] });
		emit({ type: "delta", text: "early" });
		await new Promise<never>((_, reject) =>
			signal.addEventListener(
				"abort",
				() => {
					observed();
					reject(signal.reason);
				},
				{ once: true },
			),
		);
		return { answer: "unused", sources: [] };
	};
	const app = createApp({
		corpus: {
			retrieve: async () => evidence,
			ingest: async () => ({ added: 0, changed: 0, deleted: 0, unchanged: 0 }),
		},
		provider,
		chats,
		logger,
	});
	const server = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" });
	await new Promise<void>((r) => server.once("listening", r));
	const address = server.address();
	if (!address || typeof address === "string")
		throw Error("No test server address");
	const id = randomUUID();
	const controller = new AbortController();
	try {
		const response = await fetch(`http://127.0.0.1:${address.port}/api/agent`, {
			method: "POST",
			signal: controller.signal,
			body: JSON.stringify({ sessionId: id, query: "amber" }),
		});
		const reader = response.body?.getReader();
		if (!reader) throw Error("Stream missing");
		let text = "";
		while (!text.includes('"type":"delta"'))
			text += new TextDecoder().decode((await reader.read()).value);
		controller.abort();
		await aborted;
		await new Promise((r) => setTimeout(r, 20));
		expect(await chats.history(id)).toEqual([]);
		expect(
			(
				await db.db.execute(
					sql`SELECT status, answer FROM chat_turns WHERE chat_id=${id}`,
				)
			).rows,
		).toEqual([{ status: "cancelled", answer: null }]);
	} finally {
		controller.abort();
		if ("closeAllConnections" in server) server.closeAllConnections();
		await new Promise<void>((resolve, reject) =>
			server.close((err) => (err ? reject(err) : resolve())),
		);
		await db.close();
	}
});
