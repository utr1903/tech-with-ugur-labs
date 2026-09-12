import { randomUUID } from "node:crypto";
import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	fixture,
	integration,
	until,
} from "../execution/integration-fixture.js";
import { ThreadService } from "../threads/service.js";
import { canonicalAction } from "./actions.js";
import { setupChat } from "./graph.js";
import { ScriptedModel } from "./scripted.js";

describe.skipIf(!integration)("real graph and disposable Jobs", () => {
	const f = integration ? fixture() : undefined;
	if (!f) return;
	beforeAll(async () => {
		await f.setup();
	});
	afterAll(async () => {
		await f?.pool.end();
	});
	it("replays a persisted nondeterministic model action after the checkpoint gap", async () => {
		const graph = await setupChat(
			f.pool,
			new ScriptedModel("tool"),
			f.executor.execute.bind(f.executor),
		);
		const service = new ThreadService(f.pool, graph, f.logger);
		const thread = await service.create();
		const turnId = randomUUID();
		const first = await canonicalAction(
			f.pool,
			{
				invoke: async () =>
					new AIMessage({
						content: "",
						tool_calls: [
							{
								id: "random-provider-a",
								name: "code_executor",
								args: { source: "print(81)" },
							},
						],
					}),
			},
			{
				threadId: thread.id,
				turnId,
				step: 0,
				messages: [new HumanMessage("calculate")],
				signal: new AbortController().signal,
				assertOwner: async () => {},
			},
		);
		await service.start(thread.id, {
			turnId,
			messages: [{ id: "u1", role: "user", text: "calculate" }],
		});
		await service.waitIdle();
		const events = await service.events(thread.id, turnId);
		const result = events.find((event) => event.type === "tool-result");
		expect(result?.type === "tool-result" && result.result.stdout).toBe("81\n");
		expect(result?.type === "tool-result" && result.id).toBe(
			first.tool_calls?.[0]?.id,
		);
		const restarted = new ThreadService(
			f.pool,
			await setupChat(
				f.pool,
				new ScriptedModel("tool", "print(999)"),
				f.executor.execute.bind(f.executor),
			),
			f.logger,
		);
		await restarted.start(thread.id, {
			turnId,
			messages: [{ id: "u1", role: "user", text: "calculate" }],
		});
		await restarted.waitIdle();
		expect(
			(
				await f.pool.query(
					"SELECT count(*)::int n FROM executions WHERE thread_id=$1",
					[thread.id],
				)
			).rows[0].n,
		).toBe(1);
		expect(await restarted.events(thread.id, turnId)).toEqual(events);
		const rows = await f.pool.query(
			"SELECT held FROM executions WHERE thread_id=$1",
			[thread.id],
		);
		expect(rows.rows[0].held).toBe(false);
	}, 40000);
	it("caps repeated real tool calls and can execute again after a failed turn", async () => {
		const service = new ThreadService(
			f.pool,
			await setupChat(
				f.pool,
				new ScriptedModel(
					"repeat",
					"print('marker');raise ValueError('expected')",
				),
				f.executor.execute.bind(f.executor),
			),
			f.logger,
		);
		const thread = await service.create();
		const turnId = randomUUID();
		await service.start(thread.id, {
			turnId,
			messages: [{ id: "u1", role: "user", text: "execute" }],
		});
		await service.waitIdle();
		const results = (await service.events(thread.id, turnId)).filter(
			(e) => e.type === "tool-result",
		);
		expect(results).toHaveLength(2);
		expect(
			results.every(
				(e) => e.result.status === "failed" && e.result.stdout === "marker\n",
			),
		).toBe(true);
		const healthy = new ThreadService(
			f.pool,
			await setupChat(
				f.pool,
				new ScriptedModel("tool"),
				f.executor.execute.bind(f.executor),
			),
			f.logger,
		);
		const next = randomUUID();
		await healthy.start(thread.id, {
			turnId: next,
			messages: [{ id: "u2", role: "user", text: "again" }],
		});
		await healthy.waitIdle();
		expect(
			(await healthy.events(thread.id, next)).some(
				(e) => e.type === "tool-result" && e.result.stdout === "42\n",
			),
		).toBe(true);
	}, 60000);
	it("preserves binary NUL output in durable tool events", async () => {
		const service = new ThreadService(
			f.pool,
			await setupChat(
				f.pool,
				new ScriptedModel(
					"tool",
					"import os;os.write(1,bytes([0])*8192);os.write(2,bytes([0])*8192)",
				),
				f.executor.execute.bind(f.executor),
			),
			f.logger,
		);
		const thread = await service.create();
		const turnId = randomUUID();
		await service.start(thread.id, {
			turnId,
			messages: [{ id: "binary", role: "user", text: "run" }],
		});
		await service.waitIdle();
		expect(
			(await service.events(thread.id, turnId)).some(
				(event) =>
					event.type === "tool-result" &&
					event.result.stdout === "\u0000".repeat(8192) &&
					event.result.stderr === "\u0000".repeat(8192),
			),
		).toBe(true);
	}, 30000);
	it("finishes execution cleanup before releasing a cancelled turn", async () => {
		const service = new ThreadService(
			f.pool,
			await setupChat(
				f.pool,
				new ScriptedModel(
					"tool",
					"print('started',flush=True)\nwhile True: pass",
				),
				f.executor.execute.bind(f.executor),
			),
			f.logger,
			{ turnMs: 3000, modelMs: 1000 },
		);
		const thread = await service.create();
		const turnId = randomUUID();
		await service.start(thread.id, {
			turnId,
			messages: [{ id: "deadline", role: "user", text: "run" }],
		});
		await service.waitIdle();
		const result = await f.pool.query(
			"SELECT held,result,lease_until FROM executions WHERE thread_id=$1",
			[thread.id],
		);
		expect(result.rowCount).toBe(1);
		expect(result.rows[0].result).not.toBeNull();
		expect(result.rows[0].lease_until).toBeNull();
		expect(result.rows[0].result.status).toBe("failed");
		await until(
			async () => {
				await f.executor.reconcileOutstanding();
				return (
					await f.pool.query("SELECT held FROM executions WHERE thread_id=$1", [
						thread.id,
					])
				).rows[0].held;
			},
			(held) => !held,
			20000,
		);
		const healthy = new ThreadService(
			f.pool,
			await setupChat(
				f.pool,
				{
					invoke: async (messages) => {
						const calls = messages
							.filter((m) => m instanceof AIMessage)
							.flatMap((m) => m.tool_calls ?? []);
						const outputs = messages
							.filter((m) => m instanceof ToolMessage)
							.map((m) => m.tool_call_id);
						if (calls.some((call) => !outputs.includes(call.id ?? "")))
							throw new Error("Unpaired tool history.");
						return new AIMessage("Healthy after cancellation");
					},
				},
				f.executor.execute.bind(f.executor),
			),
			f.logger,
		);
		const next = randomUUID();
		await healthy.start(thread.id, {
			turnId: next,
			messages: [{ id: "after", role: "user", text: "hello" }],
		});
		await healthy.waitIdle();
		expect((await healthy.events(thread.id, next)).at(-1)?.type).toBe("done");
	}, 30000);
});
