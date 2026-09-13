import {
	AIMessage,
	type BaseMessage,
	ToolMessage,
} from "@langchain/core/messages";
import type {
	Response,
	ResponseInput,
	ResponseOutputMessage,
} from "openai/resources/responses/responses";

function inputMessage(message: BaseMessage): ResponseInput {
	if (typeof message.content !== "string")
		throw new Error("Unsupported message content.");
	if (message instanceof ToolMessage)
		return [
			{
				type: "function_call_output",
				call_id: message.tool_call_id,
				output: message.content,
			},
		];
	if (!(message instanceof AIMessage))
		return [
			{
				role: message.type === "system" ? "system" : "user",
				content: message.content,
			},
		];
	const result: ResponseInput = message.content
		? [{ role: "assistant", content: message.content }]
		: [];
	for (const call of message.tool_calls ?? []) {
		if (!call.id) throw new Error("Tool identity missing.");
		result.push({
			type: "function_call",
			call_id: call.id,
			name: call.name,
			arguments: JSON.stringify(call.args),
		});
	}
	return result;
}
export function providerInput(messages: BaseMessage[]): ResponseInput {
	const result = messages.flatMap(inputMessage);
	if (Buffer.byteLength(JSON.stringify(result)) > 1048576)
		throw new Error("Model history too large.");
	return result;
}
function textContent(item: ResponseOutputMessage) {
	return item.content
		.map((block) => {
			if (block.type !== "output_text")
				throw new Error("Unsupported model response.");
			return block.text;
		})
		.join("");
}
export function providerAction(response: Response): AIMessage {
	if (response.status !== "completed" || response.output.length > 4)
		throw new Error("Incomplete model response.");
	let content = "";
	const calls: NonNullable<AIMessage["tool_calls"]> = [];
	for (const item of response.output) {
		if (item.type === "function_call")
			calls.push({
				id: item.call_id,
				name: item.name,
				args: JSON.parse(item.arguments),
				type: "tool_call",
			});
		else if (item.type === "message") content += textContent(item);
		else throw new Error("Unsupported model response.");
	}
	if (Buffer.byteLength(content) > 16384 || calls.length > 1)
		throw new Error("Model action too large.");
	return new AIMessage({ content, tool_calls: calls });
}
