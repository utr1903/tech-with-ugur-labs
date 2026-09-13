import assert from "node:assert/strict";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Claim } from "./claim.js";
import { Executor } from "./execute.js";
import { fixture, input, integration, until } from "./integration-fixture.js";
import { Ledger } from "./ledger.js";
import { buildJob, templateDigest } from "./template.js";
import { emptyResult } from "./types.js";

describe.skipIf(!integration)(
	"expired owners with live Kubernetes Pods",
	() => {
		let f: ReturnType<typeof fixture>;
		beforeAll(async () => {
			f = fixture();
			await f.setup();
		});
		afterAll(async () => {
			await f.pool.end();
		});
		it("fences stale live sessions while retaining both occupied slots through recovery", async () => {
			const ledger = new Ledger(f.pool);
			const stale: Claim[] = [];
			for (let i = 0; i < 2; i++) {
				const args = input(
					"import os,signal,time\nprint('lease-marker',flush=True)\ntime.sleep(0.3)\nos.kill(os.getppid(),signal.SIGSTOP)\ntime.sleep(60)",
				);
				const row = await ledger.register(args, templateDigest);
				const claim = await ledger.claim(row.id);
				assert(claim);
				stale.push(claim);
				await claim.update({ phase: "submitting" });
				const job = await f.api.createJob(
					buildJob({ executionId: row.id, source: args.source }),
				);
				assert(job.metadata?.uid);
				await claim.update({ phase: "observed", job_uid: job.metadata.uid });
			}
			await until(
				() =>
					Promise.all(stale.map((c) => f.api.listPods(`exec-${c.record.id}`))),
				(groups) =>
					groups.every((pods) => pods[0]?.status?.phase === "Running"),
			);
			await f.pool.query(
				"UPDATE executions SET lease_until=clock_timestamp()-interval '1 second' WHERE held",
			);
			await expect(stale[0]?.renew()).rejects.toThrow(/fenced/);
			const recovery = new Executor(
				f.pool,
				f.api,
				f.logger,
			).reconcileOutstanding();
			expect((await f.executor.execute(input())).status).toBe("rejected");
			expect(await ledger.outstanding()).toHaveLength(2);
			for (const owner of stale) {
				await expect(
					owner.finish(emptyResult(owner.record.id, "succeeded")),
				).rejects.toThrow(/fenced/);
				await owner.close();
			}
			await recovery;
			expect(await ledger.outstanding()).toHaveLength(0);
			expect((await f.executor.execute(input())).stdout).toBe("42\n");
		}, 45000);
	},
);
