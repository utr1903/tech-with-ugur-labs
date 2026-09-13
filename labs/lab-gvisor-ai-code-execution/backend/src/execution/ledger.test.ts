import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPool } from "../database/pool.js";
import { setupDatabase } from "../database/schema.js";
import { Ledger } from "./ledger.js";
import { emptyResult } from "./types.js";

const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)("PostgreSQL execution ledger", () => {
	const pool = createPool(url ?? "");
	const ledger = new Ledger(pool);
	beforeAll(async () => {
		await setupDatabase(pool);
		await pool.query("TRUNCATE executions");
	});
	afterAll(async () => {
		await pool.end();
	});
	const input = () => ({
		threadId: randomUUID(),
		turnId: randomUUID(),
		toolCallId: randomUUID(),
		source: "print(42)",
	});
	it("allocates random identity once and rejects changed source even after terminal persistence", async () => {
		const args = input();
		const first = await ledger.register(args, "v1");
		expect(first.id).toMatch(/^[a-f0-9]{32}$/);
		const claim = await ledger.claim(first.id);
		assert(claim);
		expect(claim).not.toBeNull();
		await claim.finish(emptyResult(first.id, "succeeded"));
		await claim.releaseCapacity();
		await claim.close();
		expect((await new Ledger(pool).register(args, "v1")).id).toBe(first.id);
		await expect(
			ledger.register({ ...args, source: "print(43)" }, "v1"),
		).rejects.toThrow(/conflict/i);
		await expect(ledger.register(args, "v2")).rejects.toThrow(/conflict/i);
	});
	it("reserves two global slots and one per thread across independent clients", async () => {
		const args = input();
		const first = await ledger.register(args, "v1");
		const blocked = await ledger.register(
			{ ...args, toolCallId: randomUUID() },
			"v1",
		);
		expect(blocked.result?.status).toBe("rejected");
		const [second, third] = await Promise.all([
			new Ledger(pool).register(input(), "v1"),
			new Ledger(pool).register(input(), "v1"),
		]);
		expect([second, third].filter((r) => r.held)).toHaveLength(1);
		expect((await ledger.outstanding()).filter((r) => r.held)).toHaveLength(2);
		for (const row of [first, second, third].filter((r) => r.held)) {
			const c = await ledger.claim(row.id);
			assert(c);
			await c.finish(emptyResult(row.id, "failed"));
			await c.releaseCapacity();
			await c.close();
		}
	});
	it("does not steal active ownership and fences a stale reconciler after reacquisition", async () => {
		const row = await ledger.register(input(), "v1");
		const old = await ledger.claim(row.id);
		assert(old);
		expect(await ledger.claim(row.id)).toBeNull();
		await old.close();
		const current = await ledger.claim(row.id);
		assert(current);
		expect(current.record.fence).toBeGreaterThan(old.record.fence);
		await expect(
			old.finish(emptyResult(row.id, "succeeded")),
		).rejects.toThrow();
		await current.finish(emptyResult(row.id, "failed"));
		await current.releaseCapacity();
		await current.close();
	});
	it("takes over an expired lease without waiting for the stale database session", async () => {
		const row = await ledger.register(input(), "v1");
		const stale = await ledger.claim(row.id);
		assert(stale);
		await pool.query(
			"UPDATE executions SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",
			[row.id],
		);
		const replacement = await ledger.claim(row.id);
		expect(replacement).not.toBeNull();
		assert(replacement);
		await expect(
			stale.finish(emptyResult(row.id, "succeeded")),
		).rejects.toThrow(/fenced|ownership/i);
		await expect(stale.releaseCapacity()).rejects.toThrow();
		await replacement.finish(emptyResult(row.id, "failed"));
		await replacement.releaseCapacity();
		await replacement.close();
		await stale.close();
	});
});
