import type OpenAI from "openai";
import type { AgentSessionEvent } from "openai/resources/beta/agents/agents";
import { SafeError } from "../http/errors.js";
import type { Pending } from "./types.js";
export function requiredCalls(
	value: Extract<AgentSessionEvent, { type: "agent.session.requires_action" }>,
): Pending[] {
	return (
		value.session.required_actions
			?.filter((action) => action.type === "function_call")
			.map((action) => ({
				turnId: action.turn_id,
				callId: action.call_id,
				name: action.name,
				arguments: action.arguments,
			})) ?? []
	);
}
export async function finalAnswer(
	client: OpenAI,
	id: string,
	turnId: string,
	signal: AbortSignal,
) {
	let answer = "";
	let count = 0;
	for await (const item of client.beta.agents.sessions.items.list(
		id,
		{ order: "asc", limit: 100 },
		{ signal },
	)) {
		if (++count > 1000) throw new SafeError("Managed history limit exceeded");
		if (
			item.type === "message" &&
			item.turn_id === turnId &&
			item.role === "assistant" &&
			item.phase === "final_answer" &&
			item.status === "completed"
		)
			answer += item.content
				.filter((part) => part.type === "output_text")
				.map((part) => part.text)
				.join("");
	}
	return answer;
}
