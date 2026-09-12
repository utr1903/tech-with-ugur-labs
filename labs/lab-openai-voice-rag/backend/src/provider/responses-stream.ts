import type {
	ResponseOutputItem,
	ResponseStreamEvent,
} from "openai/resources/responses/responses";
import { SafeError } from "../http/errors.js";
import type { AgentEvent } from "./types.js";

function check(event: ResponseStreamEvent) {
	if (
		event.type === "response.failed" ||
		event.type === "response.incomplete" ||
		event.type === "error"
	)
		throw new SafeError("Document agent failed");
}
export async function retrievalOutput(
	stream: AsyncIterable<ResponseStreamEvent>,
	signal: AbortSignal,
) {
	const output: ResponseOutputItem[] = [];
	let completed = false;
	for await (const event of stream) {
		signal.throwIfAborted();
		check(event);
		if (event.type === "response.output_item.done") output.push(event.item);
		if (event.type === "response.completed") completed = true;
	}
	const calls = output.filter((item) => item.type === "function_call");
	if (!completed || calls.length !== 1)
		throw new SafeError("Provider retrieval was not completed");
	const call = calls[0];
	if (!call) throw new SafeError("Provider skipped retrieval");
	return {
		call,
		output: output.filter(
			(item) => item.type === "message" || item.type === "function_call",
		),
	};
}
export async function finalText(
	stream: AsyncIterable<ResponseStreamEvent>,
	signal: AbortSignal,
	emit: (event: AgentEvent) => void,
) {
	let answer = "";
	let completed = false;
	for await (const event of stream) {
		signal.throwIfAborted();
		check(event);
		if (event.type === "response.output_text.delta") {
			answer += event.delta;
			if (answer.length > 12000)
				throw new SafeError("Provider answer too large");
			emit({ type: "delta", text: event.delta });
		}
		if (event.type === "response.completed") completed = true;
		if (
			event.type === "response.output_item.done" &&
			event.item.type === "function_call"
		)
			throw new SafeError("Unexpected provider action");
	}
	if (!completed || !answer.trim())
		throw new SafeError("Provider answer was not completed");
	return answer;
}
