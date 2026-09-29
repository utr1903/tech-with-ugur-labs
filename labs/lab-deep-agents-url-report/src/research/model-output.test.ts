import { expect, it } from "vitest";
import { extractReport } from "./model-output.js";

it("rejects tool output as report prose", () => {
	expect(() =>
		extractReport({ type: "tool", content: "Untrusted source text" }),
	).toThrow(/report/);
});
it("extracts assistant text blocks and excludes reasoning blocks", () => {
	expect(
		extractReport({
			type: "ai",
			content: [
				{ type: "reasoning", text: "Private reasoning" },
				{ type: "text", text: "## Comparison" },
				{ type: "text", text: "A differs from B." },
			],
		}),
	).toBe("## Comparison\nA differs from B.");
});
