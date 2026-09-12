import { setTimeout as delay } from "node:timers/promises";
import type { Pool } from "pg";
import type { ChatGraph } from "../graph/graph.js";
import type { Logger } from "../logger.js";
import { readEvents } from "./events.js";
import { finalize } from "./finalize.js";
import { acquire, type Ownership } from "./ownership.js";
import { type ClientTurn, parseTurn, type UserMessage } from "./reconcile.js";
import { ThreadStore, type TurnRow } from "./store.js";
export class ThreadService extends ThreadStore {
	private readonly running = new Map<string, Promise<void>>();
	private readonly limits: { turnMs: number; modelMs: number };
	constructor(
		pool: Pool,
		private readonly graph: ChatGraph,
		private readonly logger: Logger,
		limits = { turnMs: 300000, modelMs: 120000 },
	) {
		super(pool);
		this.limits = limits;
	}
	async start(threadId: string, raw: unknown) {
		const request = parseTurn(raw);
		await this.exists(threadId);
		const previous = await this.turn(threadId, request.turnId);
		if (previous) {
			this.same(previous, request);
			if (previous.status === "active") await this.resume(previous);
			return;
		}
		const owner = await acquire(this.pool, threadId);
		if (!owner) throw new Error("Thread is busy.");
		try {
			const raced = await this.turn(threadId, request.turnId);
			if (raced) {
				this.same(raced, request);
				await owner.close();
				if (raced.status === "active") await this.resume(raced);
				return;
			}
			const messages = await this.register(
				owner,
				threadId,
				request,
				this.limits.turnMs,
			);
			const row = await this.turn(threadId, request.turnId);
			if (!row) throw new Error("Turn registration missing.");
			this.launch(owner, row, messages);
		} catch (err) {
			await owner.close();
			throw err;
		}
	}
	private same(row: TurnRow, request: ClientTurn) {
		if (JSON.stringify(row.request) !== JSON.stringify(request))
			throw new Error("Turn replay conflict.");
	}
	private launch(owner: Ownership, row: TurnRow, messages: UserMessage[]) {
		const key = `${row.thread_id}:${row.id}`;
		const task = this.run(owner, row, messages).finally(() =>
			this.running.delete(key),
		);
		this.running.set(key, task);
	}
	private async run(owner: Ownership, row: TurnRow, messages: UserMessage[]) {
		const fields = { threadId: row.thread_id, turnId: row.id };
		this.logger.info(fields, "Running turn...");
		const remaining = Math.max(1, row.deadline.getTime() - Date.now());
		const signal = AbortSignal.any([
			owner.abort.signal,
			AbortSignal.timeout(remaining),
		]);
		try {
			await this.graph.run({
				...fields,
				messages,
				signal,
				modelMs: this.limits.modelMs,
				assertOwner: () => owner.assert(),
			});
			await owner.assert();
			await finalize(owner.client, row.thread_id, row.id, "done");
			this.logger.info(fields, "Running turn succeeded.");
		} catch (err) {
			this.logger.error({ err, ...fields }, "Running turn failed.");
			try {
				await owner.assert();
				await finalize(owner.client, row.thread_id, row.id, "error");
			} catch (cleanupErr) {
				this.logger.error(
					{ err: cleanupErr, ...fields },
					"Recording turn failure failed.",
				);
			}
		} finally {
			await owner.close();
		}
	}
	private async resume(row: TurnRow) {
		if (this.running.has(`${row.thread_id}:${row.id}`)) return;
		const owner = await acquire(this.pool, row.thread_id);
		if (!owner) return;
		try {
			// Re-read under ownership: a previous owner may have committed completion.
			const current = await this.turn(row.thread_id, row.id);
			if (current?.status !== "active") {
				await owner.close();
				return;
			}
			this.launch(owner, current, current.request.messages);
		} catch (err) {
			await owner.close();
			throw err;
		}
	}
	async recover() {
		const rows = await this.pool.query<TurnRow>(
			"SELECT * FROM chat_turns WHERE status='active' ORDER BY created_at LIMIT 4",
		);
		for (const row of rows.rows) await this.resume(row);
	}
	events(threadId: string, turnId: string, after = 0) {
		return readEvents(this.pool, threadId, turnId, after);
	}
	async wait(threadId: string, turnId: string) {
		for (let i = 0; i < 3100; i++) {
			const row = await this.turn(threadId, turnId);
			if (row?.status !== "active") return;
			await delay(100);
		}
		throw new Error("Turn wait deadline.");
	}
	async waitIdle() {
		await Promise.all(this.running.values());
	}
}
