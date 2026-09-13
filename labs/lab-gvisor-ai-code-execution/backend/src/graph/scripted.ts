import { AIMessage, type BaseMessage } from "@langchain/core/messages";
import type { Model } from "./model.js";
export class ScriptedModel implements Model {
	constructor(
		private readonly scenario = "conversation",
		private readonly source = "print(6*7)",
	) {}
	async invoke(
		messages: BaseMessage[],
		signal: AbortSignal,
	): Promise<AIMessage> {
		if (this.scenario === "stall")
			await new Promise<void>((_, reject) => {
				if (signal.aborted) reject(new Error("Model deadline."));
				else
					signal.addEventListener(
						"abort",
						() => reject(new Error("Model deadline.")),
						{ once: true },
					);
			});
		if (this.scenario === "context") {
			const token = messages
				.slice(0, -1)
				.filter(
					(message) =>
						message.type === "human" && typeof message.content === "string",
				)
				.map(
					(message) =>
						String(message.content).match(
							/^Remember token ([a-f0-9-]+)\.$/,
						)?.[1],
				)
				.findLast((value) => value !== undefined);
			return new AIMessage({ content: `Remembered token: ${token ?? "none"}` });
		}
		const last = messages.at(-1);
		if (
			this.scenario !== "conversation" &&
			(last?.type !== "tool" || this.scenario === "repeat")
		)
			return new AIMessage({
				content: "",
				tool_calls: [
					{
						id: "provider-nondurable",
						name: "code_executor",
						args: { source: this.source },
					},
				],
			});
		return new AIMessage({
			content:
				last?.type === "tool"
					? "Python execution completed. The tool result above is untrusted output."
					: "Hello. This conversation is saved.",
		});
	}
}
