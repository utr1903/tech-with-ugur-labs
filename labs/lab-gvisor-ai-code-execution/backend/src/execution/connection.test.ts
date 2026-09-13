import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createPool } from "../database/pool.js";
import { setupDatabase } from "../database/schema.js";
import { Ledger } from "./ledger.js";
import { emptyResult } from "./types.js";

const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)("lost PostgreSQL ownership", () => {
	it("fences a disconnected worker and releases its checked-out connection", async () => {
		const pool = createPool(url ?? "");
		const control = createPool(url ?? "");
		await setupDatabase(pool);
		const ledger = new Ledger(pool);
		const row = await ledger.register(
			{
				threadId: randomUUID(),
				turnId: randomUUID(),
				toolCallId: randomUUID(),
				source: "print(42)",
			},
			"connection-test",
		);
		const owner = await ledger.claim(row.id);
		if (!owner) throw new Error("Missing owner");
		const killed = await control.query(
			"SELECT pg_terminate_backend(pid) AS killed FROM pg_stat_activity WHERE application_name=$1",
			[`execution-${row.id}`],
		);
		expect(killed.rows[0]?.killed).toBe(true);
		await new Promise((r) => setTimeout(r, 100));
		await expect(
			owner.finish(emptyResult(row.id, "succeeded")),
		).rejects.toThrow(/ownership|connection/i);
		await owner.close();
		await control.query(
			"UPDATE executions SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",
			[row.id],
		);
		const replacement = await new Ledger(control).claim(row.id);
		if (!replacement) throw new Error("Missing replacement");
		await replacement.finish(emptyResult(row.id, "failed"));
		await replacement.releaseCapacity();
		await replacement.close();
		const drained = await Promise.race([
			pool.end().then(() => true),
			new Promise<boolean>((r) => setTimeout(() => r(false), 1000)),
		]);
		expect(drained).toBe(true);
		await control.end();
	}, 10000);
});
