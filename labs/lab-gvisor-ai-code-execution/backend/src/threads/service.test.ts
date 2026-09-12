import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPool } from "../database/pool.js";
import { setupChat } from "../graph/graph.js";
import { ScriptedModel } from "../graph/scripted.js";
import { createLogger } from "../logger.js";
import { ThreadService } from "./service.js";

const url = process.env.TEST_DATABASE_URL;
const pool = createPool(url ?? "postgres://localhost/unused");
const logger = createLogger({ appName: "graph-test" });
logger.level = "silent";
let service: ThreadService;
describe.skipIf(!url)("durable real graph turns", () => {
	beforeAll(async () => {
		const graph = await setupChat(pool, new ScriptedModel(), async () => {
			throw new Error("Unexpected tool");
		});
		service = new ThreadService(pool, graph, logger);
	});
	afterAll(() => pool.end());
	it("persists conversational turns, rejects changed replay, and separates threads", async () => {
		const thread = await service.create();
		const other = await service.create();
		const input = {
			turnId: randomUUID(),
			messages: [{ id: "u1", role: "user" as const, text: "hello" }],
		};
		await service.start(thread.id, input);
		await service.wait(thread.id, input.turnId);
		const first = await service.history(thread.id);
		expect(first.messages.filter((m) => m.role === "user")).toHaveLength(1);
		expect(first.messages.filter((m) => m.role === "assistant")).toHaveLength(
			1,
		);
		expect((await service.history(other.id)).messages).toHaveLength(0);
		await service.start(thread.id, input);
		await service.wait(thread.id, input.turnId);
		expect((await service.history(thread.id)).messages).toEqual(first.messages);
		await expect(
			service.start(thread.id, {
				...input,
				messages: [{ id: "u1", role: "user", text: "changed" }],
			}),
		).rejects.toThrow();
		await expect(service.start(randomUUID(), input)).rejects.toThrow();
		await service.start(thread.id, {
			turnId: randomUUID(),
			messages: [...input.messages, { id: "u2", role: "user", text: "again" }],
		});
		await service.waitIdle();
		expect(
			(await service.history(thread.id)).messages.filter(
				(m) => m.role === "user",
			),
		).toHaveLength(2);
	});
	it("holds nonblocking thread ownership and four global durable turn slots", async () => {
		const stalled = await setupChat(
			pool,
			new ScriptedModel("stall"),
			async () => {
				throw new Error("Unexpected tool");
			},
		);
		const active = new ThreadService(pool, stalled, logger, {
			turnMs: 800,
			modelMs: 500,
		});
		const threads = await Promise.all(
			Array.from({ length: 5 }, () => active.create()),
		);
		const input = {
			turnId: randomUUID(),
			messages: [{ id: "u", role: "user" as const, text: "hello" }],
		};
		assert(threads[0] && threads[4]);
		for (const thread of threads.slice(0, 4))
			await active.start(thread.id, input);
		await expect(
			active.start(threads[0].id, { ...input, turnId: randomUUID() }),
		).rejects.toThrow();
		await expect(active.start(threads[4].id, input)).rejects.toThrow();
		await active.waitIdle();
		expect(
			(
				await pool.query(
					"SELECT count(*)::int n FROM chat_turns WHERE status='active'",
				)
			).rows[0].n,
		).toBe(0);
		await service.start(threads[0].id, {
			...input,
			turnId: randomUUID(),
			messages: [{ id: "after", role: "user", text: "healthy" }],
		});
		await service.waitIdle();
		expect(
			(await service.history(threads[0].id)).messages.some(
				(m) => m.role === "assistant",
			),
		).toBe(true);
	});
	it("bounds a model adapter that ignores cancellation", async () => {
		const stuck = await setupChat(
			pool,
			{ invoke: () => new Promise(() => {}) },
			async () => {
				throw new Error("Unexpected tool");
			},
		);
		const bounded = new ThreadService(pool, stuck, logger, {
			modelMs: 60,
			turnMs: 200,
		});
		const thread = await bounded.create();
		await bounded.start(thread.id, {
			turnId: randomUUID(),
			messages: [{ id: "u1", role: "user", text: "stall" }],
		});
		await bounded.waitIdle();
		expect((await bounded.history(thread.id)).activeTurn).toBeNull();
	});
	it("scopes a reused client turn ID and its assistant IDs to each server thread", async () => {
		const first = await service.create();
		const second = await service.create();
		const turnId = randomUUID();
		const input = {
			turnId,
			messages: [{ id: "u", role: "user" as const, text: "hello" }],
		};
		await service.start(first.id, input);
		await service.start(second.id, input);
		await service.waitIdle();
		const a = (await service.history(first.id)).messages.find(
			(m) => m.role === "assistant",
		);
		const b = (await service.history(second.id)).messages.find(
			(m) => m.role === "assistant",
		);
		expect(a?.id).not.toBe(b?.id);
	});
});
