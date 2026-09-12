import { expect, it } from "vitest";
import { boundedHistory } from "./history.js";

it("keeps the latest twenty whole turns in chronological order", () => {
	const turns = Array.from({ length: 25 }, (_, i) => ({
		query: `q${25 - i}`,
		answer: `a${25 - i}`,
	}));
	const history = boundedHistory(turns);
	expect(history).toHaveLength(40);
	expect(history[0]).toEqual({ role: "user", content: "q6" });
	expect(history.at(-1)).toEqual({ role: "assistant", content: "a25" });
});
it("bounds characters without splitting or skipping a recent whole turn", () => {
	const history = boundedHistory([
		{ query: "q".repeat(10000), answer: "a".repeat(10000) },
		{ query: "b".repeat(10000), answer: "c".repeat(10000) },
		{ query: "older", answer: "old" },
	]);
	expect(history).toHaveLength(4);
	expect(history.reduce((n, m) => n + m.content.length, 0)).toBe(40000);
	expect(
		boundedHistory([
			{ query: "too large", answer: "a".repeat(40000) },
			{ query: "old", answer: "old" },
		]),
	).toEqual([]);
});
