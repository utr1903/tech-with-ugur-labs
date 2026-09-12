import type { PoolClient } from "pg";
import type { ExecutionRecord, ExecutionResult } from "./types.js";
export class Claim {
	private closed = false;
	private disconnected = false;
	private readonly connectionError = () => {
		this.disconnected = true;
	};
	constructor(
		private readonly client: PoolClient,
		public record: ExecutionRecord,
	) {
		client.on("error", this.connectionError);
	}
	async update(
		values: Partial<
			Pick<
				ExecutionRecord,
				"phase" | "job_uid" | "pod_uid" | "log_budget" | "result" | "held"
			>
		>,
	): Promise<void> {
		if (this.closed || this.disconnected)
			throw new Error("Execution ownership lost.");
		const entries = Object.entries(values);
		const updated = await this.client.query<ExecutionRecord>(
			`UPDATE executions SET lease_until=clock_timestamp()+interval '12 seconds'${entries.map(([key], i) => `,${key}=$${i + 3}`).join("")} WHERE id=$1 AND fence=$2 AND lease_until>clock_timestamp() RETURNING *`,
			[this.record.id, this.record.fence, ...entries.map(([, value]) => value)],
		);
		if (!updated.rows[0]) throw new Error("Execution ownership fenced.");
		this.record = updated.rows[0];
	}
	async finish(result: ExecutionResult): Promise<void> {
		await this.update({ phase: "terminal", result });
	}
	async releaseCapacity(): Promise<void> {
		if (!this.record.result)
			throw new Error("Persist terminal result before releasing capacity.");
		await this.update({ held: false });
	}

	async renew(): Promise<void> {
		await this.update({});
	}
	async close(): Promise<void> {
		if (this.closed) return;
		this.closed = true;
		try {
			if (!this.disconnected)
				await this.client.query(
					"UPDATE executions SET lease_until=NULL WHERE id=$1 AND fence=$2",
					[this.record.id, this.record.fence],
				);
		} finally {
			this.client.removeListener("error", this.connectionError);
			this.client.release(true);
		}
	}
}
