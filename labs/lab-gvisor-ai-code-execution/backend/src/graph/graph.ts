import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { END, START, StateGraph } from "@langchain/langgraph";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import type { Pool } from "pg";
import { appendEvent } from "../threads/events.js";
import type { UserMessage } from "../threads/reconcile.js";
import { setupThreads } from "../threads/schema.js";
import { canonicalAction, stableId } from "./actions.js";
import type { ToolExecutor } from "./execute-tool.js";
import type { Model } from "./model.js";
import { interruptedOutputs } from "./repair.js";
import { State } from "./state.js";
import { toolNode } from "./tool.js";
export type GraphRun = {
	threadId: string;
	turnId: string;
	messages: UserMessage[];
	signal: AbortSignal;
	modelMs: number;
	assertOwner: () => Promise<void>;
};
export async function setupChat(
	pool: Pool,
	model: Model,
	execute: ToolExecutor,
) {
	await setupThreads(pool);
	const saver = new PostgresSaver(pool);
	await saver.setup();
	return {
		async run(input: GraphRun) {
			const pending: Promise<unknown>[] = [];
			const graph = new StateGraph(State)
				.addNode("model", async (state) => {
					const signal = AbortSignal.any([
						input.signal,
						AbortSignal.timeout(input.modelMs),
					]);
					const action = await canonicalAction(pool, model, {
						...input,
						step: state.step,
						messages: state.messages,
						signal,
					});
					if ((action.tool_calls?.length ?? 0) > 0 && state.tools >= 2)
						throw new Error("Tool limit reached.");
					return { messages: [action], step: state.step + 1 };
				})
				.addNode("tool", (state) => {
					const operation = toolNode(pool, execute, input, state);
					pending.push(operation);
					return operation;
				})
				.addEdge(START, "model")
				.addConditionalEdges("model", (state) => {
					const last = state.messages.at(-1);
					return last instanceof AIMessage && last.tool_calls?.length
						? "tool"
						: END;
				})
				.addEdge("tool", "model")
				.compile({ checkpointer: saver });
			const config = {
				configurable: { thread_id: input.threadId },
				durability: "sync" as const,
				recursionLimit: 8,
				signal: input.signal,
			};
			const current = await graph.getState(config);
			const same = current.values.turnId === input.turnId;
			const repaired = same
				? []
				: await interruptedOutputs(
						pool,
						input.threadId,
						current.values.messages ?? [],
					);
			const invoke = async () =>
				same && !current.next.length
					? current.values
					: await graph.invoke(
							same
								? null
								: {
										messages: [
											...repaired,
											...input.messages.map(
												(m) =>
													new HumanMessage({
														id: stableId(input.threadId, m.id, "user"),
														content: m.text,
													}),
											),
										],
										turnId: input.turnId,
										step: 0,
										tools: 0,
									},
							config,
						);
			const state = await invoke().finally(async () => {
				await Promise.allSettled(pending);
			});
			await input.assertOwner();
			const last = state.messages.at(-1);
			if (!(last instanceof AIMessage) || typeof last.content !== "string")
				throw new Error("Missing assistant result.");
			const id = last.id ?? stableId(input.turnId, "answer");
			await pool.query(
				"INSERT INTO chat_messages(thread_id,id,role,text) VALUES($1,$2,'assistant',$3) ON CONFLICT DO NOTHING",
				[input.threadId, id, last.content],
			);
			await appendEvent(pool, input.threadId, input.turnId, id, {
				type: "assistant",
				id,
				text: last.content,
			});
		},
	};
}
export type ChatGraph = Awaited<ReturnType<typeof setupChat>>;
