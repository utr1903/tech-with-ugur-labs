import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fixture, integration } from "../execution/integration-fixture.js";
import { ThreadService } from "../threads/service.js";
import { setupChat } from "./graph.js";
import { ScriptedModel } from "./scripted.js";

describe.skipIf(!integration)(
	"process death across graph and execution persistence",
	() => {
		const f = integration ? fixture() : undefined;
		if (!f) return;
		beforeAll(() => f.setup());
		afterAll(() => f.pool.end());
		it.each(["action", "registered", "result"])(
			"resumes after %s persistence without changing source or repeating Jobs",
			async (point) => {
				const service = new ThreadService(
					f.pool,
					await setupChat(
						f.pool,
						new ScriptedModel("tool", "print(999)"),
						f.executor.execute.bind(f.executor),
					),
					f.logger,
				);
				const thread = await service.create();
				const turnId = randomUUID();
				const child = spawn(
					process.execPath,
					["--import", "tsx", "scripts/crash-worker.mjs"],
					{
						cwd: process.cwd(),
						env: {
							...process.env,
							CRASH_POINT: point,
							CRASH_THREAD: thread.id,
							CRASH_TURN: turnId,
						},
						stdio: "ignore",
					},
				);
				const stopped = await new Promise<string | null>((resolve, reject) => {
					const timer = setTimeout(() => {
						child.kill("SIGKILL");
						reject(new Error("Crash fixture deadline."));
					}, 30000);
					child.on("exit", (_code, signal) => {
						clearTimeout(timer);
						resolve(signal);
					});
				});
				expect(stopped).toBe("SIGKILL");
				if (point === "result") await delay(12500);
				await f.executor.reconcileOutstanding();
				await service.recover();
				await service.waitIdle();
				const events = await service.events(thread.id, turnId);
				expect(
					events.some(
						(event) =>
							event.type === "tool-result" && event.result.stdout === "81\n",
					),
				).toBe(true);
				expect(events.at(-1)?.type).toBe("done");
				const rows = await f.pool.query(
					"SELECT held FROM executions WHERE thread_id=$1",
					[thread.id],
				);
				expect(rows.rowCount).toBe(1);
				expect(rows.rows[0].held).toBe(false);
			},
			60000,
		);
	},
);
