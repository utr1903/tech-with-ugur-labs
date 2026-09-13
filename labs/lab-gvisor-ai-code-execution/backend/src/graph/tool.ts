import { AIMessage, ToolMessage } from "@langchain/core/messages";
import type { Pool } from "pg";
import { appendEvent } from "../threads/events.js";
import { stableId } from "./actions.js";
import { executeTool, type ToolExecutor } from "./execute-tool.js";
import type { GraphRun } from "./graph.js";
import type { State } from "./state.js";
export async function toolNode(
	pool: Pool,
	execute: ToolExecutor,
	input: GraphRun,
	state: typeof State.State,
) {
	await input.assertOwner();
	input.signal.throwIfAborted();
	const action = state.messages.at(-1);
	if (!(action instanceof AIMessage)) throw new Error("Missing tool action.");
	const call = action.tool_calls?.[0];
	if (!call?.id) throw new Error("Missing tool identity.");
	const toolId = call.id;
	const result = await executeTool(
		execute,
		{
			threadId: input.threadId,
			turnId: input.turnId,
			toolCallId: call.id,
			source: call.args.source,
		},
		input.signal,
		(executionId) =>
			appendEvent(pool, input.threadId, input.turnId, `${call.id}:start`, {
				type: "tool-start",
				id: toolId,
				executionId,
			}),
	);
	await input.assertOwner();
	await appendEvent(pool, input.threadId, input.turnId, `${call.id}:start`, {
		type: "tool-start",
		id: call.id,
		executionId: result.executionId,
	});
	await pool.query(
		"INSERT INTO chat_messages(thread_id,id,role,text) VALUES($1,$2,'tool',$3) ON CONFLICT DO NOTHING",
		[input.threadId, `tool:${call.id}`, JSON.stringify(result)],
	);
	await appendEvent(pool, input.threadId, input.turnId, `${call.id}:result`, {
		type: "tool-result",
		id: call.id,
		result,
	});
	return {
		messages: [
			new ToolMessage({
				id: stableId(call.id, "result"),
				tool_call_id: call.id,
				content: JSON.stringify(result),
			}),
		],
		tools: state.tools + 1,
	};
}
