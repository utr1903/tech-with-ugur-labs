import type { Pool } from "pg";
import type { ExecutionResult } from "../execution/types.js";
export type EventData =
	| { type: "assistant"; id: string; text: string }
	| { type: "tool-start"; id: string; executionId: string }
	| { type: "tool-result"; id: string; result: ExecutionResult }
	| { type: "done" }
	| { type: "error"; message: string };
export type ChatEvent = EventData & { sequence: number };
export async function appendEvent(
	pool: Pool,
	threadId: string,
	turnId: string,
	key: string,
	event: EventData,
) {
	await pool.query(
		"INSERT INTO chat_events(thread_id,turn_id,key,event) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING",
		[threadId, turnId, key, JSON.stringify(event)],
	);
}
export async function readEvents(
	pool: Pool,
	threadId: string,
	turnId: string,
	after = 0,
): Promise<ChatEvent[]> {
	const result = await pool.query(
		"SELECT sequence,event FROM chat_events WHERE thread_id=$1 AND turn_id=$2 AND sequence>$3 ORDER BY sequence LIMIT 16",
		[threadId, turnId, after],
	);
	return result.rows.map((row) => ({
		...row.event,
		sequence: Number(row.sequence),
	}));
}
