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

describe.skipIf(!integration)("capture and identity recovery", () => {
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
	it("fails successful-container capture without a final frame and does not reread logs on replay", async () => {
		let reads = 0;
		const api = override(f.api, {
			async readLogs(name, budget) {
				reads++;
				const wire = await f.api.readLogs(name, budget);
				return {
					...wire,
					data: Buffer.from(
						wire.data
							.toString()
							.split("\n")
							.filter((line) => !line.includes('"captureComplete":true'))
							.join("\n"),
					),
				};
			},
		});
		const args = input();
		const result = await new Executor(f.pool, api, f.logger).execute(args);
		expect(result.status).toBe("failed");
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toBe("42\n");
		expect(await new Executor(f.pool, api, f.logger).execute(args)).toEqual(
			result,
		);
		expect(reads).toBe(1);
		expect(
			(
				await f.pool.query("SELECT log_budget FROM executions WHERE id=$1", [
					result.executionId,
				])
			).rows[0].log_budget,
		).toBe(0);
	}, 40000);
	it("rejects a conflicting Job source before adoption", async () => {
		const args = input();
		const row = await ledger.register(args, templateDigest);
		const owner = await ledger.claim(row.id);
		assert(owner);
		await owner.update({ phase: "submitting" });
		const job = await f.api.createJob(
			buildJob({ executionId: row.id, source: "print(43)" }),
		);
		await owner.close();
		await expect(f.executor.execute(args)).rejects.toThrow(/conflict/i);
		const uid = job.metadata?.uid;
		assert(uid);
		await f.api.deleteJob(`exec-${row.id}`, uid);
		await until(
			() => f.api.getJob(`exec-${row.id}`),
			(job) => job === null,
		);
		await until(
			() => f.api.listPods(`exec-${row.id}`),
			(pods) => pods.length === 0,
		);
		const cleanup = await ledger.claim(row.id);
		assert(cleanup);
		await cleanup.finish(emptyResult(row.id, "failed"));
		await cleanup.releaseCapacity();
		await cleanup.close();
	}, 40000);
	it("rejects a Pod with a different controller Job UID", async () => {
		const args = input();
		const api = override(f.api, {
			async listPods(name) {
				return (await f.api.listPods(name)).map((pod) => ({
					...pod,
					metadata: {
						...pod.metadata,
						ownerReferences: [
							{
								apiVersion: "batch/v1",
								kind: "Job",
								name,
								uid: "unrelated",
								controller: true,
							},
						],
					},
				}));
			},
		});
		await expect(
			new Executor(f.pool, api, f.logger).execute(args),
		).rejects.toThrow(/controller identity/i);
		expect((await f.executor.execute(args)).stdout).toBe("42\n");
	}, 40000);
	it("rejects a changed exact Pod UID at log-read time and never resets the spent budget", async () => {
		const args = input();
		const api = override(f.api, {
			async getPod(name) {
				const pod = await f.api.getPod(name);
				return pod
					? { ...pod, metadata: { ...pod.metadata, uid: "replacement" } }
					: pod;
			},
		});
		await expect(
			new Executor(f.pool, api, f.logger).execute(args),
		).rejects.toThrow(/Log Pod identity/i);
		const result = await f.executor.execute(args);
		expect(result.status).toBe("failed");
		expect(result.stdout).toBe("");
		expect(await ledger.outstanding()).toHaveLength(0);
	}, 40000);
});
