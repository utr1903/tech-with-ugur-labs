import assert from "node:assert/strict";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Executor } from "./execute.js";
import {
	fixture,
	input,
	integration,
	override,
	until,
} from "./integration-fixture.js";
import { Ledger } from "./ledger.js";
import { buildJob, templateDigest } from "./template.js";
import { emptyResult } from "./types.js";

describe.skipIf(!integration)("durable crash and cancellation recovery", () => {
	let f: ReturnType<typeof fixture>;
	let ledger: Ledger;
	beforeAll(async () => {
		f = fixture();
		await f.setup();
		ledger = new Ledger(f.pool);
	});
	afterAll(async () => {
		await f.pool.end();
	});
	it("adopts the same Job after crash in the submission/ack gap", async () => {
		const args = input();
		const row = await ledger.register(args, templateDigest);
		const owner = await ledger.claim(row.id);
		assert(owner);
		await owner.update({ phase: "submitting" });
		const created = await f.api.createJob(
			buildJob({ executionId: row.id, source: args.source }),
		);
		await owner.close();
		await expect(
			f.executor.execute({ ...args, source: "print(43)" }),
		).rejects.toThrow(/conflict/i);
		const result = await f.executor.execute(args);
		expect(result.stdout).toBe("42\n");
		expect(result.status).toBe("succeeded");
		const saved = await f.pool.query(
			"SELECT job_uid,held FROM executions WHERE id=$1",
			[row.id],
		);
		expect(saved.rows[0]).toEqual({
			job_uid: created.metadata?.uid,
			held: false,
		});
	}, 40000);
	it("reconciles an unknown create response without issuing a second create", async () => {
		const api = override(f.api, {
			async createJob(job) {
				await f.api.createJob(job);
				throw new Error("Simulated lost API response.");
			},
		});
		const result = await new Executor(f.pool, api, f.logger).execute(input());
		expect(result.status).toBe("succeeded");
		expect(result.stdout).toBe("42\n");
	}, 40000);
	it("returns the persisted terminal result after crash before deletion and reclaims capacity", async () => {
		const args = input();
		const row = await ledger.register(args, templateDigest);
		const owner = await ledger.claim(row.id);
		assert(owner);
		await owner.update({ phase: "submitting" });
		const job = await f.api.createJob(
			buildJob({ executionId: row.id, source: args.source }),
		);
		await owner.update({
			phase: "observed",
			job_uid: job.metadata?.uid ?? null,
		});
		const expected = emptyResult(row.id, "failed", "Stored before crash");
		await owner.finish(expected);
		await owner.close();
		expect(await f.executor.execute(args)).toEqual(expected);
		expect(await f.api.getJob(`exec-${row.id}`)).toBeNull();
		expect(await ledger.outstanding()).toHaveLength(0);
	}, 40000);
	it("quarantines two missing possibly-started submissions until their late Jobs are confirmed stopped", async () => {
		const registered = [];
		for (let i = 0; i < 2; i++) {
			const args = input();
			const row = await ledger.register(args, templateDigest);
			registered.push(row);
			const old = await ledger.claim(row.id);
			assert(old);
			await old.update({ phase: "submitting" });
			await old.close();
		}
		await new Executor(f.pool, f.api, f.logger).reconcileOutstanding();
		expect(await ledger.outstanding()).toHaveLength(2);
		expect((await f.executor.execute(input())).status).toBe("rejected");
		for (const row of registered) {
			const cached = await f.executor.execute({
				threadId: row.thread_id,
				turnId: row.turn_id,
				toolCallId: row.tool_call_id,
				source: row.source,
			});
			expect(cached.status).toBe("failed");
			expect(cached.stderr).toContain("indeterminate");
			await f.api.createJob(
				buildJob({ executionId: row.id, source: row.source }),
			);
		}
		await f.executor.reconcileOutstanding();
		expect(await ledger.outstanding()).toHaveLength(0);
		expect((await f.executor.execute(input())).status).toBe("succeeded");
	}, 50000);
	it("holds both slots across cancellation, stale ownership and delayed deletion", async () => {
		let blocked = true;
		let persisted = 0;
		const api = override(f.api, {
			async deleteJob(name, uid) {
				const row = await f.pool.query(
					"SELECT result FROM executions WHERE id=$1",
					[name.slice(5)],
				);
				expect(row.rows[0].result).not.toBeNull();
				persisted++;
				if (!blocked) await f.api.deleteJob(name, uid);
			},
		});
		const executor = new Executor(f.pool, api, f.logger);
		const signals = [new AbortController(), new AbortController()];
		const executions = signals.map((s) =>
			executor.execute(
				input("import time\nprint('marker',flush=True)\ntime.sleep(30)"),
				s.signal,
			),
		);
		const rows = await until(
			() => ledger.outstanding(),
			(rows) => rows.length === 2 && rows.every((row) => row.pod_uid !== null),
		);
		await until(
			() => Promise.all(rows.map((r) => f.api.listPods(`exec-${r.id}`))),
			(groups) => groups.every((p) => p[0]?.status?.phase === "Running"),
		);
		signals.forEach((s) => {
			s.abort();
		});
		const results = await Promise.all(executions);
		expect(results.every((r) => r.status === "failed")).toBe(true);
		expect(persisted).toBe(2);
		expect(await ledger.outstanding()).toHaveLength(2);
		expect((await executor.execute(input())).status).toBe("rejected");
		blocked = false;
		await new Executor(f.pool, api, f.logger).reconcileOutstanding();
		expect(await ledger.outstanding()).toHaveLength(0);
		expect((await f.executor.execute(input())).stdout).toBe("42\n");
	}, 50000);
});
