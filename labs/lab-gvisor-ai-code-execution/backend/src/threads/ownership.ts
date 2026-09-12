import type { Pool, PoolClient } from "pg";
export async function acquire(pool: Pool, threadId: string) {
	const client = await pool.connect();
	try {
		const result = await client.query(
			"SELECT pg_try_advisory_lock(hashtextextended($1, 47319)) AS locked",
			[threadId],
		);
		if (!result.rows[0].locked) {
			client.release();
			return null;
		}
		return new Ownership(client);
	} catch (err) {
		client.release(true);
		throw err;
	}
}
export class Ownership {
	readonly abort = new AbortController();
	private closed = false;
	constructor(readonly client: PoolClient) {
		client.on("error", () => this.abort.abort());
	}
	async assert() {
		if (this.closed) throw new Error("Turn ownership lost.");
		this.abort.signal.throwIfAborted();
		await this.client.query("SELECT 1");
	}
	async close() {
		if (this.closed) return;
		this.closed = true;
		this.abort.abort();
		this.client.release(true);
	}
}
