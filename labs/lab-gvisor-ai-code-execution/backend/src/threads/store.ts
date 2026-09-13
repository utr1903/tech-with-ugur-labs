import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { Ownership } from "./ownership.js";
import { type ClientTurn, reconcile, type UserMessage } from "./reconcile.js";
export type TurnRow = {
	thread_id: string;
	id: string;
	request: ClientTurn;
	status: "active" | "done" | "error";
	deadline: Date;
};
export class ThreadStore {
	constructor(readonly pool: Pool) {}
	async create() {
		const id = randomUUID();
		await this.pool.query("INSERT INTO chat_threads(id) VALUES($1)", [id]);
		return { id };
	}
	async list() {
		return (
			await this.pool.query(
				"SELECT id,created_at FROM chat_threads ORDER BY created_at DESC LIMIT 100",
			)
		).rows;
	}
	async exists(id: string) {
		if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("Unknown thread.");
		if (
			!(await this.pool.query("SELECT id FROM chat_threads WHERE id=$1", [id]))
				.rowCount
		)
			throw new Error("Unknown thread.");
	}
	async turn(threadId: string, turnId: string): Promise<TurnRow | undefined> {
		return (
			await this.pool.query(
				"SELECT * FROM chat_turns WHERE thread_id=$1 AND id=$2",
				[threadId, turnId],
			)
		).rows[0];
	}
	async history(threadId: string) {
		await this.exists(threadId);
		const messages = await this.pool.query<{
			id: string;
			role: string;
			text: string;
		}>(
			"SELECT id,role,text FROM chat_messages WHERE thread_id=$1 ORDER BY ordinal LIMIT 256",
			[threadId],
		);
		const active = await this.pool.query(
			"SELECT id,deadline FROM chat_turns WHERE thread_id=$1 AND status='active'",
			[threadId],
		);
		return { messages: messages.rows, activeTurn: active.rows[0] ?? null };
	}
	async register(
		owner: Ownership,
		threadId: string,
		request: ClientTurn,
		turnMs: number,
	): Promise<UserMessage[]> {
		const client = owner.client;
		await client.query("BEGIN");
		try {
			const lock = await client.query(
				"SELECT pg_try_advisory_xact_lock(47319, 1) locked",
			);
			if (!lock.rows[0].locked) throw new Error("Turn admission busy.");
			const count = await client.query(
				"SELECT count(*)::int n FROM chat_turns WHERE status='active'",
			);
			if (count.rows[0].n >= 4) throw new Error("Active turn limit reached.");
			const saved = await client.query<{ id: string; text: string }>(
				"SELECT id,text FROM chat_messages WHERE thread_id=$1 AND role='user' ORDER BY ordinal LIMIT 65",
				[threadId],
			);
			const added = reconcile(saved.rows, request.messages);
			if (!added.length || saved.rows.length + added.length > 64)
				throw new Error("No new input or thread history limit reached.");
			await client.query(
				"INSERT INTO chat_turns(thread_id,id,request,status,deadline) VALUES($1,$2,$3,'active',clock_timestamp()+$4*interval '1 millisecond')",
				[threadId, request.turnId, JSON.stringify(request), turnMs],
			);
			for (const message of added)
				await client.query(
					"INSERT INTO chat_messages(thread_id,id,role,text) VALUES($1,$2,'user',$3)",
					[threadId, message.id, message.text],
				);
			await client.query("COMMIT");
			return added;
		} catch (err) {
			await client.query("ROLLBACK");
			throw err;
		}
	}
}
