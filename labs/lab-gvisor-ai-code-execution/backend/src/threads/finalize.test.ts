import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPool } from "../database/pool.js";
import { finalize } from "./finalize.js";
import { acquire } from "./ownership.js";
import { setupThreads } from "./schema.js";

const url = process.env.TEST_DATABASE_URL;
const pool = createPool(url ?? "postgres://localhost/unused");
afterAll(() => pool.end());
describe.skipIf(!url)("atomic final turn persistence", () => {
	beforeAll(async () => {
		await setupThreads(pool);
		const rows = await pool.query(
			"SELECT thread_id FROM chat_turns WHERE id='turn' AND request='{}'::jsonb AND status='active'",
		);
		for (const row of rows.rows) {
			const owner = await acquire(pool, row.thread_id);
			if (owner) {
				try {
					await finalize(owner.client, row.thread_id, "turn", "error");
				} finally {
					await owner.close();
				}
			}
		}
	});
	it("rolls back the terminal event when its status update fails", async () => {
		await setupThreads(pool);
		const id = randomUUID();
		await pool.query("INSERT INTO chat_threads(id) VALUES($1)", [id]);
		await pool.query(
			"INSERT INTO chat_turns(thread_id,id,request,status,deadline) VALUES($1,'turn','{}','active',clock_timestamp())",
			[id],
		);
		const owner = await acquire(pool, id);
		if (!owner) throw new Error("Missing fixture lock.");
		const query = owner.client.query.bind(owner.client);
		const client = new Proxy(owner.client, {
			get(target, key) {
				if (key === "query")
					return (...args: Parameters<typeof query>) => {
						if (
							typeof args[0] === "string" &&
							args[0].startsWith("UPDATE chat_turns")
						)
							throw new Error("Simulated status write failure.");
						return Reflect.apply(query, target, args);
					};
				const value = Reflect.get(target, key);
				return typeof value === "function" ? value.bind(target) : value;
			},
		});
		try {
			await expect(finalize(client, id, "turn", "error")).rejects.toThrow();
			expect(
				(await pool.query("SELECT * FROM chat_events WHERE thread_id=$1", [id]))
					.rowCount,
			).toBe(0);
			expect(
				(
					await pool.query("SELECT status FROM chat_turns WHERE thread_id=$1", [
						id,
					])
				).rows[0].status,
			).toBe("active");
			await finalize(owner.client, id, "turn", "error");
		} finally {
			await finalize(owner.client, id, "turn", "error");
			await owner.close();
		}
	});
});
