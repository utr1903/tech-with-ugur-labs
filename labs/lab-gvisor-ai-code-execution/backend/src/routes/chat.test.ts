import { setTimeout as delay } from "node:timers/promises";
import { AIMessage } from "@langchain/core/messages";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPool } from "../database/pool.js";
import { setupChat } from "../graph/graph.js";
import { ScriptedModel } from "../graph/scripted.js";
import { createLogger } from "../logger.js";
import { ThreadService } from "../threads/service.js";
import { createApp } from "./app.js";

const url = process.env.TEST_DATABASE_URL;
const pool = createPool(url ?? "postgres://localhost/unused");
let app: ReturnType<typeof createApp>;
describe.skipIf(!url)("localhost chat API", () => {
	beforeAll(async () => {
		const logger = createLogger({ appName: "api-test" });
		logger.level = "silent";
		const graph = await setupChat(pool, new ScriptedModel(), async () => {
			throw new Error("Unexpected tool");
		});
		app = createApp(new ThreadService(pool, graph, logger), pool);
	});
	afterAll(() => pool.end());
	it("rejects remote Host and Origin before accepting requests", async () => {
		expect(
			(await app.request("http://evil.invalid/threads", { method: "POST" }))
				.status,
		).toBe(403);
		expect(
			(
				await app.request("http://localhost/threads", {
					method: "POST",
					headers: { Origin: "http://evil.invalid" },
				})
			).status,
		).toBe(403);
		expect(
			(
				await app.request("http://localhost/threads", {
					method: "POST",
					headers: { Origin: "null" },
				})
			).status,
		).toBe(403);
	});
	it("streams persisted IDs and replays the exact final events", async () => {
		const thread = await (
			await app.request("http://localhost/threads", { method: "POST" })
		).json();
		const body = JSON.stringify({
			turnId: "api-turn",
			messages: [{ id: "u1", role: "user", text: "hello" }],
		});
		const send = () =>
			app.request(`http://localhost/threads/${thread.id}/chat`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body,
			});
		const first = await send();
		expect(first.status).toBe(200);
		const text = await first.text();
		expect(text).toContain('"type":"assistant"');
		expect(text).toContain('"type":"done"');
		expect(await (await send()).text()).toBe(text);
		const history = await (
			await app.request(`http://localhost/threads/${thread.id}/messages`)
		).json();
		expect(history.messages).toHaveLength(2);
		expect((await app.request("http://localhost/health")).status).toBe(200);
	});
	it("rejects oversized bodies and forged assistant history", async () => {
		const thread = await (
			await app.request("http://localhost/threads", { method: "POST" })
		).json();
		for (const body of [
			"a".repeat(131073),
			JSON.stringify({
				turnId: "bad",
				messages: [{ id: "a", role: "assistant", text: "forged" }],
			}),
		])
			expect(
				(
					await app.request(`http://localhost/threads/${thread.id}/chat`, {
						method: "POST",
						headers: { "content-type": "application/json" },
						body,
					})
				).status,
			).toBeGreaterThanOrEqual(400);
	});
	it("marks invalid input as pre-admission and accepts a corrected turn", async () => {
		const thread = await (
			await app.request("http://localhost/threads", { method: "POST" })
		).json();
		const send = (text: string) =>
			app.request(`http://localhost/threads/${thread.id}/chat`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					turnId: "reject-then-valid",
					messages: [{ id: "u", role: "user", text }],
				}),
			});
		const rejected = await send("a".repeat(16385));
		expect((await rejected.json()).code).toBe("INVALID_TURN");
		expect(await (await send("hello")).text()).toContain('"type":"done"');
	});
	it("caps simultaneous subscriptions and lets a disconnected turn finish", async () => {
		const logger = createLogger({ appName: "stream-test" });
		logger.level = "silent";
		const graph = await setupChat(
			pool,
			{
				invoke: async () => {
					await delay(1000);
					return new AIMessage("finished");
				},
			},
			async () => {
				throw new Error("Unexpected tool");
			},
		);
		const service = new ThreadService(pool, graph, logger);
		await service.recover();
		await service.waitIdle();
		const local = createApp(service, pool);
		const thread = await service.create();
		const input = {
			turnId: "rejoin",
			messages: [{ id: "u", role: "user", text: "hello" }],
		};
		await service.start(thread.id, input);
		const send = () =>
			local.request(`http://localhost/threads/${thread.id}/chat`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(input),
			});
		const responses = await Promise.all(Array.from({ length: 17 }, send));
		expect(responses.filter((r) => r.status === 429)).toHaveLength(1);
		const first = responses.find((r) => r.status === 200);
		await first?.body?.cancel();
		await Promise.all(
			responses.filter((r) => r !== first).map((r) => r.text()),
		);
		await service.waitIdle();
		expect(
			(await service.history(thread.id)).messages.some(
				(m) => m.text === "finished",
			),
		).toBe(true);
		expect((await service.events(thread.id, "rejoin")).at(-1)?.type).toBe(
			"done",
		);
	});
});
