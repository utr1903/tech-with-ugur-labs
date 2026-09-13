import {
	AIMessage,
	type BaseMessage,
	ToolMessage,
} from "@langchain/core/messages";
import type { Pool } from "pg";
import { stableId } from "./actions.js";
export async function interruptedOutputs(
	pool: Pool,
	threadId: string,
	messages: BaseMessage[],
): Promise<ToolMessage[]> {
	const finished = new Set(
		messages
			.filter((message) => message instanceof ToolMessage)
			.map((message) => message.tool_call_id),
	);
	const calls = messages
		.filter((message) => message instanceof AIMessage)
		.flatMap((message) => message.tool_calls ?? []);
	const repaired: ToolMessage[] = [];
	for (const call of calls) {
		if (!call.id || finished.has(call.id)) continue;
		const stored = await pool.query(
			"SELECT event FROM chat_events WHERE thread_id=$1 AND key=$2 LIMIT 1",
			[threadId, `${call.id}:result`],
		);
		const content = stored.rows[0]
			? JSON.stringify(stored.rows[0].event.result)
			: "The previous turn ended before a tool result could be delivered. No new execution is requested.";
		repaired.push(
			new ToolMessage({
				id: stableId(call.id, "result"),
				tool_call_id: call.id,
				content,
			}),
		);
	}
	return repaired;
}
