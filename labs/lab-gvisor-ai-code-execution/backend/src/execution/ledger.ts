import { randomBytes } from "node:crypto";
import type { Pool } from "pg";
import { Claim } from "./claim.js";
import { sourceDigest } from "./template.js";
import {
	type ExecutionInput,
	type ExecutionRecord,
	emptyResult,
} from "./types.js";
export class Ledger {
	constructor(private readonly pool: Pool) {}
	async register(
		input: ExecutionInput,
		templateHash: string,
	): Promise<ExecutionRecord> {
		const hash = sourceDigest(input.source);
		const client = await this.pool.connect();
		try {
			await client.query("BEGIN");
			// This short transaction serializes admission only, never a Kubernetes wait.
			await client.query("SELECT pg_advisory_xact_lock(736921)");
			const existing = await client.query<ExecutionRecord>(
				"SELECT * FROM executions WHERE thread_id=$1 AND turn_id=$2 AND tool_call_id=$3",
				[input.threadId, input.turnId, input.toolCallId],
			);
			const row = existing.rows[0];
			if (row) {
				if (row.source_hash !== hash || row.template_hash !== templateHash)
					throw new Error("Execution source/template conflict.");
				await client.query("COMMIT");
				return row;
			}
			const slots = await client.query<{ count: string; same: boolean }>(
				"SELECT count(*)::text,coalesce(bool_or(thread_id=$1),false) AS same FROM executions WHERE held",
				[input.threadId],
			);
			const held = Number(slots.rows[0]?.count) < 2 && !slots.rows[0]?.same;
			const id = randomBytes(16).toString("hex");
			const result = held
				? null
				: emptyResult(id, "rejected", "Execution capacity is occupied.");
			const inserted = await client.query<ExecutionRecord>(
				`INSERT INTO executions(id,thread_id,turn_id,tool_call_id,source,source_hash,template_hash,phase,held,result)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
				[
					id,
					input.threadId,
					input.turnId,
					input.toolCallId,
					input.source,
					hash,
					templateHash,
					held ? "reserved" : "terminal",
					held,
					result,
				],
			);
			await client.query("COMMIT");
			if (!inserted.rows[0]) throw new Error("Execution registration missing.");
			return inserted.rows[0];
		} catch (err) {
			await client.query("ROLLBACK");
			throw err;
		} finally {
			client.release();
		}
	}

	async claim(id: string): Promise<Claim | null> {
		const client = await this.pool.connect();
		try {
			await client.query("SELECT set_config('application_name',$1,false)", [
				`execution-${id}`,
			]);
			const updated = await client.query<ExecutionRecord>(
				`UPDATE executions SET fence=fence+1,lease_until=clock_timestamp()+interval '12 seconds'
    WHERE id=$1 AND (lease_until IS NULL OR lease_until<=clock_timestamp()) RETURNING *`,
				[id],
			);
			const record = updated.rows[0];
			if (!record) {
				client.release(true);
				return null;
			}
			return new Claim(client, record);
		} catch (err) {
			client.release(true);
			throw err;
		}
	}

	async outstanding(): Promise<ExecutionRecord[]> {
		return (
			await this.pool.query<ExecutionRecord>(
				"SELECT * FROM executions WHERE held ORDER BY deadline LIMIT 2",
			)
		).rows;
	}
}
