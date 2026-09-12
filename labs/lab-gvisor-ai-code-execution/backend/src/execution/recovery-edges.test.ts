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

describe.skipIf(!integration)("recovery boundaries", () => {
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
	it("releases a disappeared acknowledged Job after confirming all its Pods absent", async () => {
		const api = override(f.api, {
			async createJob(job) {
				const created = await f.api.createJob(job);
				const name = created.metadata?.name;
				const uid = created.metadata?.uid;
				if (!name || !uid) throw new Error("Missing identity");
				await f.api.deleteJob(name, uid);
				await until(
					() => f.api.getJob(name),
					(job) => job === null,
				);
				await until(
					() => f.api.listPods(name),
					(pods) => pods.length === 0,
				);
				return created;
			},
		});
		const result = await new Executor(f.pool, api, f.logger).execute(input());
		expect(result.status).toBe("failed");
		expect(result.stderr).toContain("indeterminate");
		expect(await ledger.outstanding()).toHaveLength(0);
	}, 40000);
	it("never restarts an expired reserved execution", async () => {
		const args = input();
		const row = await ledger.register(args, templateDigest);
		await f.pool.query(
			"UPDATE executions SET deadline=clock_timestamp()-interval '1 second' WHERE id=$1",
			[row.id],
		);
		const result = await f.executor.execute(args);
		expect(result.status).toBe("timeout");
		expect(result.stdout).toBe("");
		expect(
			(
				await f.pool.query("SELECT job_uid FROM executions WHERE id=$1", [
					row.id,
				])
			).rows[0].job_uid,
		).toBeNull();
	}, 40000);
	it("uses the Kubernetes Job deadline after backend downtime, preserving early output", async () => {
		const args = input(
			"import os,signal,time\nprint('job-deadline-marker',flush=True)\ntime.sleep(0.3)\nos.kill(os.getppid(),signal.SIGSTOP)\ntime.sleep(60)",
		);
		const row = await ledger.register(args, templateDigest);
		const claim = await ledger.claim(row.id);
		if (!claim) throw new Error("Missing claim");
		await claim.update({ phase: "submitting" });
		await f.api.createJob(
			buildJob({ executionId: row.id, source: args.source }),
		);
		await claim.close();
		await until(
			() => f.api.getJob(`exec-${row.id}`),
			(job) =>
				Boolean(
					job?.status?.conditions?.some(
						(c) => c.reason === "DeadlineExceeded" && c.status === "True",
					),
				),
			30000,
		);
		const result = await f.executor.execute(args);
		expect(result.status).toBe("timeout");
		expect(result.stdout).toContain("job-deadline-marker");
	}, 45000);
	it("recovers capacity after a definite admission denial without a runtime fallback", async () => {
		const api = override(f.api, {
			async createJob(job) {
				const pod = job.spec?.template.spec;
				assert(pod);
				pod.runtimeClassName = "runc";
				return f.api.createJob(job);
			},
		});
		const result = await new Executor(f.pool, api, f.logger).execute(input());
		expect(result.status).toBe("rejected");
		expect(await ledger.outstanding()).toHaveLength(0);
		expect(await f.api.listPods(`exec-${result.executionId}`)).toHaveLength(0);
		expect((await f.executor.execute(input())).stdout).toBe("42\n");
	}, 40000);
});
