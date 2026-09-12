import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	fixture,
	integration,
	until,
} from "../execution/integration-fixture.js";
import { ThreadService } from "../threads/service.js";
import type { ToolExecutor } from "./execute-tool.js";
import { setupChat } from "./graph.js";
import { ScriptedModel } from "./scripted.js";

describe.skipIf(!integration)("execution recovery ownership race", () => {
	const f = integration ? fixture() : undefined;
	if (!f) return;
	beforeAll(() => f.setup());
	afterAll(() => f.pool.end());
	it("rejoins the same execution when periodic recovery claims registration first", async () => {
		let first = true;
		let recovery: Promise<void> | undefined;
		const execute: ToolExecutor = (input, signal, onRegistered) =>
			f.executor.execute(input, signal, async (id) => {
				await onRegistered?.(id);
				if (!first) return;
				first = false;
				recovery = f.executor.reconcileOutstanding();
				await until(
					async () =>
						(
							await f.pool.query(
								"SELECT lease_until IS NOT NULL active FROM executions WHERE id=$1",
								[id],
							)
						).rows[0]?.active,
					Boolean,
				);
			});
		const service = new ThreadService(
			f.pool,
			await setupChat(f.pool, new ScriptedModel("tool"), execute),
			f.logger,
		);
		const thread = await service.create();
		const turnId = randomUUID();
		await service.start(thread.id, {
			turnId,
			messages: [{ id: "u", role: "user", text: "calculate" }],
		});
		await service.waitIdle();
		await recovery;
		const events = await service.events(thread.id, turnId);
		expect(events.at(-1)?.type).toBe("done");
		expect(events.filter((e) => e.type === "tool-start")).toHaveLength(1);
		expect(
			(
				await f.pool.query(
					"SELECT count(*)::int n FROM executions WHERE thread_id=$1",
					[thread.id],
				)
			).rows[0].n,
		).toBe(1);
	}, 30000);
});
