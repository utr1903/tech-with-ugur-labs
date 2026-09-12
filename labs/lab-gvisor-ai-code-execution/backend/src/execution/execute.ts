import { setTimeout as delay } from "node:timers/promises";
import type { Pool } from "pg";
import type { Logger } from "../logger.js";
import type { Claim } from "./claim.js";
import { cleanup } from "./cleanup.js";
import type { KubernetesApi } from "./kubernetes.js";
import { Ledger } from "./ledger.js";
import { classification, observe } from "./observation.js";
import { collectResult } from "./result.js";
import { submit } from "./submission.js";
import { templateDigest } from "./template.js";
import {
	type ExecutePython,
	type ExecutionResult,
	emptyResult,
} from "./types.js";
export class Executor {
	private readonly ledger: Ledger;
	constructor(
		pool: Pool,
		private readonly api: KubernetesApi,
		private readonly logger: Logger,
	) {
		this.ledger = new Ledger(pool);
	}
	async execute(
		input: Parameters<ExecutePython>[0],
		signal?: AbortSignal,
	): Promise<ExecutionResult> {
		const fields = {
			threadId: input.threadId,
			turnId: input.turnId,
			toolCallId: input.toolCallId,
			sourceBytes: Buffer.byteLength(input.source),
		};
		this.logger.info(fields, "Executing Python...");
		try {
			const row = await this.ledger.register(input, templateDigest);
			const claim = await this.ledger.claim(row.id);
			if (!claim) {
				if (row.result) return row.result;
				throw new Error("Execution is already being reconciled.");
			}
			try {
				const result = await this.run(claim, signal);
				this.logger.info(
					{ executionId: result.executionId, status: result.status },
					"Executing Python succeeded.",
				);
				return result;
			} finally {
				await claim.close();
			}
		} catch (err) {
			this.logger.error({ err, ...fields }, "Executing Python failed.");
			throw err;
		}
	}
	async reconcileOutstanding(): Promise<void> {
		for (const row of await this.ledger.outstanding()) {
			// Never adopt work using a changed deployment template.
			if (row.template_hash !== templateDigest)
				throw new Error("Execution template conflict during recovery.");
			const claim = await this.ledger.claim(row.id);
			if (!claim) continue;
			try {
				await this.run(claim);
			} finally {
				await claim.close();
			}
		}
	}
	private async run(
		claim: Claim,
		signal?: AbortSignal,
	): Promise<ExecutionResult> {
		if (claim.record.result) {
			await cleanup(this.api, claim);
			return claim.record.result;
		}
		if (claim.record.phase === "reserved") {
			const early = await submit(this.api, claim, this.logger, signal);
			if (early) return early;
		}
		for (;;) {
			await claim.renew();
			const job = await this.api.getJob(`exec-${claim.record.id}`);
			if (!job) {
				await claim.finish(
					emptyResult(
						claim.record.id,
						"failed",
						"Execution outcome indeterminate: registered Job missing; source will not be rerun.",
					),
				);
				break;
			}
			const pods = await observe(this.api, claim, job);
			const state = classification(
				job,
				pods[0],
				claim.record,
				signal?.aborted ?? false,
			);
			if (state) {
				await claim.finish(
					await collectResult(
						this.api,
						claim,
						pods[0],
						state.status,
						state.exitCode,
						this.logger,
					),
				);
				break;
			}
			await delay(100);
		}
		await cleanup(this.api, claim);
		if (!claim.record.result) throw new Error("Terminal result missing.");
		return claim.record.result;
	}
}
