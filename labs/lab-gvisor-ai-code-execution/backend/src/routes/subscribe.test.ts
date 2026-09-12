import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { afterAll, describe, expect, it } from "vitest";
import { createPool } from "../database/pool.js";
import { emptyResult } from "../execution/types.js";
import { createLogger } from "../logger.js";
import { appendEvent } from "../threads/events.js";
import { finalize } from "../threads/finalize.js";
import { setupThreads } from "../threads/schema.js";
import { ThreadService } from "../threads/service.js";
import { subscribe } from "./subscribe.js";

const url = process.env.TEST_DATABASE_URL;
const pool = createPool(url ?? "postgres://localhost/unused");
afterAll(() => pool.end());
describe.skipIf(!url)("persisted subscription completion", () => {
	it.each(["done", "error"] as const)(
		"delivers events committed between an empty event read and %s status read",
		async (status) => {
			await setupThreads(pool);
			const logger = createLogger({ appName: "subscription-test" });
			logger.level = "silent";
			let emptyRead = false;
			let committed = false;
			class InterleavedService extends ThreadService {
				override async events(threadId: string, turnId: string, after = 0) {
					const events = await super.events(threadId, turnId, after);
					if (!events.length && !committed) emptyRead = true;
					return events;
				}
				override async turn(threadId: string, turnId: string) {
					if (emptyRead && !committed) {
						committed = true;
						await appendEvent(pool, threadId, turnId, "tool", {
							type: "tool-result",
							id: "stable-tool",
							result: emptyResult("execution", "succeeded", ""),
						});
						await appendEvent(pool, threadId, turnId, "answer", {
							type: "assistant",
							id: "stable-answer",
							text: "saved answer",
						});
						const client = await pool.connect();
						try {
							await finalize(client, threadId, turnId, status);
						} finally {
							client.release();
						}
					}
					return super.turn(threadId, turnId);
				}
			}
			const service = new InterleavedService(
				pool,
				{ run: async () => {} },
				logger,
			);
			const thread = await service.create();
			const turnId = randomUUID();
			await pool.query(
				"INSERT INTO chat_turns(thread_id,id,request,status,deadline) VALUES($1,$2,'{}','active',clock_timestamp()+interval '1 minute')",
				[thread.id, turnId],
			);
			const app = new Hono();
			app.get("/events", (c) =>
				streamSSE(c, (stream) =>
					subscribe(service, stream, thread.id, turnId, 0),
				),
			);
			const text = await (await app.request("http://localhost/events")).text();
			const received = text
				.split("\n")
				.filter((line) => line.startsWith("data: "))
				.map((line) => JSON.parse(line.slice(6)));
			expect(received.map((event) => event.type)).toEqual([
				"tool-result",
				"assistant",
				status,
			]);
			expect(received.map((event) => event.sequence)).toEqual(
				(await service.events(thread.id, turnId)).map(
					(event) => event.sequence,
				),
			);
		},
	);
});
