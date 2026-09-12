import { createHash } from "node:crypto";
import { AIMessage, type BaseMessage } from "@langchain/core/messages";
import type { Pool } from "pg";
import { abortable } from "../lib/abort.js";
import type { Model } from "./model.js";
export function stableId(...values: string[]) {
	return createHash("sha256").update(JSON.stringify(values)).digest("hex");
}
export async function canonicalAction(
	pool: Pool,
	model: Model,
	input: {
		threadId: string;
		turnId: string;
		step: number;
		messages: BaseMessage[];
		signal: AbortSignal;
		assertOwner: () => Promise<void>;
	},
) {
	const key = [input.threadId, input.turnId, input.step];
	await input.assertOwner();
	const cached = await pool.query(
		"SELECT action FROM chat_actions WHERE thread_id=$1 AND turn_id=$2 AND step=$3",
		key,
	);
	if (cached.rowCount) return new AIMessage(cached.rows[0].action);
	const raw = await abortable(
		model.invoke(input.messages, input.signal),
		input.signal,
	);
	await input.assertOwner();
	input.signal.throwIfAborted();
	if (
		typeof raw.content !== "string" ||
		Buffer.byteLength(raw.content) > 16384 ||
		(raw.tool_calls?.length ?? 0) > 1
	)
		throw new Error("Model action exceeds bounds.");
	const calls = (raw.tool_calls ?? []).map((call) => {
		if (
			call.name !== "code_executor" ||
			Object.keys(call.args).join() !== "source" ||
			typeof call.args.source !== "string" ||
			Buffer.byteLength(call.args.source) > 16384
		)
			throw new Error("Invalid tool action.");
		return {
			id: stableId(...key.map(String), "tool"),
			name: "code_executor",
			args: { source: call.args.source },
			type: "tool_call" as const,
		};
	});
	const action = {
		id: stableId(...key.map(String), "assistant"),
		content: raw.content,
		tool_calls: calls,
	};
	await pool.query(
		"INSERT INTO chat_actions(thread_id,turn_id,step,action) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING",
		[...key, JSON.stringify(action)],
	);
	const stored = await pool.query(
		"SELECT action FROM chat_actions WHERE thread_id=$1 AND turn_id=$2 AND step=$3",
		key,
	);
	return new AIMessage(stored.rows[0].action);
}
