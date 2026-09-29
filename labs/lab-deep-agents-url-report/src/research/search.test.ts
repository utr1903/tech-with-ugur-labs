import OpenAI from "openai";
import { describe, expect, it } from "vitest";
import { searchWeb } from "./search.js";

function client(output: unknown[], requests: unknown[]) {
	return new OpenAI({
		apiKey: "test-key",
		fetch: async (_url, init) => {
			requests.push(JSON.parse(String(init?.body)));
			return Response.json({
				id: "resp_test",
				object: "response",
				created_at: 1,
				status: "completed",
				model: "search-model",
				output,
			});
		},
	});
}
const call = {
	type: "web_search_call",
	id: "ws_1",
	status: "completed",
	action: {
		type: "search",
		queries: ["latest context"],
		sources: [{ type: "url", url: "https://example.org/background" }],
	},
};
const message = {
	type: "message",
	id: "msg_1",
	role: "assistant",
	status: "completed",
	content: [
		{
			type: "output_text",
			text: "A current finding",
			annotations: [
				{
					type: "url_citation",
					url: "https://example.org/news",
					title: "News",
					start_index: 0,
					end_index: 17,
				},
			],
		},
	],
};
describe("hosted search", () => {
	it("requires hosted search and collects citation and action source metadata", async () => {
		const requests: unknown[] = [];
		const result = await searchWeb(
			"latest context",
			client([call, message], requests),
			"search-model",
		);
		expect(requests).toEqual([
			expect.objectContaining({
				model: "search-model",
				tools: [{ type: "web_search" }],
				tool_choice: "required",
				include: ["web_search_call.action.sources"],
			}),
		]);
		expect(result).toEqual({
			text: "A current finding",
			callObserved: true,
			citations: [
				{ url: "https://example.org/background" },
				{ url: "https://example.org/news", title: "News" },
			],
		});
	});
	it("rejects model prose without an actual search call", async () => {
		await expect(
			searchWeb("latest", client([message], []), "search-model"),
		).rejects.toThrow(/web_search_call/);
	});
	it("rejects an incomplete hosted call", async () => {
		await expect(
			searchWeb(
				"latest",
				client([{ ...call, status: "failed" }, message], []),
				"search-model",
			),
		).rejects.toThrow(/web_search_call/);
	});
});
