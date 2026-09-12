import type OpenAI from "openai";
import { expect, it } from "vitest";
import { createLogger } from "../logger.js";
import { createOpenAIProvider } from "./openai.js";

const logger = createLogger({ appName: "provider-test" });
logger.level = "silent";
const source = {
	id: "s",
	filename: "amber.md",
	ordinal: 0,
	text: "Amber valve recovery code is ORCHID-47.",
};
function fake(rounds: unknown[][], requests: unknown[]) {
	return {
		responses: {
			create: async (params: unknown) => {
				requests.push(params);
				const events = rounds.shift() ?? [];
				return (async function* () {
					for (const event of events) yield event;
				})();
			},
		},
	} as unknown as OpenAI;
}
const call = {
	type: "function_call",
	id: "fc",
	name: "retrieve_documents",
	call_id: "correlation",
	arguments: JSON.stringify({ question: "amber valve recovery code" }),
	status: "completed",
};
it("forces one retrieval then streams only the tools-disabled final answer with local history", async () => {
	const requests: unknown[] = [];
	const events: unknown[] = [];
	const queries: string[] = [];
	const client = fake(
		[
			[
				{ type: "response.output_text.delta", delta: "hidden prose" },
				{ type: "response.output_item.done", item: call },
				{ type: "response.completed" },
			],
			[
				{ type: "response.output_text.delta", delta: "ORCHID-" },
				{ type: "response.output_text.delta", delta: "47." },
				{ type: "response.completed" },
			],
		],
		requests,
	);
	const answer = await createOpenAIProvider(client, logger).run({
		history: [
			{ role: "user", content: "old" },
			{ role: "assistant", content: "old answer" },
		],
		query: "amber valve recovery code",
		signal: new AbortController().signal,
		retrieve: async (query) => {
			queries.push(query);
			return { sources: [source], context: source.text };
		},
		emit: (event) => events.push(event),
	});
	expect(queries).toEqual(["amber valve recovery code"]);
	expect(answer.answer).toBe("ORCHID-47.");
	expect(events).toEqual([
		{ type: "sources", sources: [source] },
		{ type: "status", stage: "answering" },
		{ type: "delta", text: "ORCHID-" },
		{ type: "delta", text: "47." },
	]);
	expect(requests[0]).toMatchObject({
		model: "gpt-4.1-mini-2025-04-14",
		store: false,
		stream: true,
		parallel_tool_calls: false,
		tool_choice: { type: "function", name: "retrieve_documents" },
		input: [
			{ role: "user", content: "old" },
			{ role: "assistant", content: "old answer" },
			{ role: "user", content: "amber valve recovery code" },
		],
	});
	expect(requests[1]).toMatchObject({
		tools: [],
		tool_choice: "none",
		store: false,
		input: expect.arrayContaining([
			{
				type: "function_call_output",
				call_id: "correlation",
				output: JSON.stringify({ sources: [source], context: source.text }),
			},
		]),
	});
});
it.each(
	(
		[
			[],
			[{ type: "response.incomplete" }],
			[
				{ type: "response.output_item.done", item: call },
				{ type: "response.output_item.done", item: call },
				{ type: "response.completed" },
			],
			[
				{
					type: "response.output_item.done",
					item: { ...call, arguments: '{"question":"amber","extra":true}' },
				},
				{ type: "response.completed" },
			],
		] as unknown[][]
	).map((first) => ({ first })),
)("rejects invalid or incomplete retrieval round", async ({ first }) => {
	const client = fake([first], []);
	await expect(
		createOpenAIProvider(client, logger).run({
			history: [],
			query: "amber",
			signal: new AbortController().signal,
			retrieve: async () => {
				throw Error("Retrieval should not start");
			},
			emit: () => {},
		}),
	).rejects.toThrow();
});
it("does not treat final stream exhaustion after partial output as success", async () => {
	const client = fake(
		[
			[
				{ type: "response.output_item.done", item: call },
				{ type: "response.completed" },
			],
			[{ type: "response.output_text.delta", delta: "partial" }],
		],
		[],
	);
	await expect(
		createOpenAIProvider(client, logger).run({
			history: [],
			query: "amber",
			signal: new AbortController().signal,
			retrieve: async () => ({ sources: [], context: "" }),
			emit: () => {},
		}),
	).rejects.toThrow("not completed");
});
