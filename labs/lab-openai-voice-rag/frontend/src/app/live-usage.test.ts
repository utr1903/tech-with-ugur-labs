import { expect, test } from "vitest";
import { completionUsage } from "./live-usage";

test("records only observed numeric completion usage without provider payloads", () => {
	expect(
		completionUsage([
			{
				type: "response.done",
				response: {
					id: "response-1",
					usage: {
						input_tokens: 12,
						output_tokens: 4,
						total_tokens: 16,
						private: "secret",
						input_token_details: { cached_tokens: 2 },
					},
				},
			},
			{ type: "response.done", response: { usage: null } },
			{
				type: "response.done",
				response: {
					usage: {
						input_tokens: "secret",
						output_tokens: -1,
						total_tokens: Number.NaN,
					},
				},
			},
			{ type: "response.created", response: { usage: { total_tokens: 999 } } },
		]),
	).toEqual([{ input_tokens: 12, output_tokens: 4, total_tokens: 16 }]);
});
