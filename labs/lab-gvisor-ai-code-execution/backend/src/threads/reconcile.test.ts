import { describe, expect, it } from "vitest";
import { parseTurn, reconcile } from "./reconcile.js";

describe("client history reconciliation", () => {
	it("adds only the new user suffix of repeated full history", () => {
		expect(
			reconcile(
				[{ id: "u1", text: "hello" }],
				[
					{ id: "u1", role: "user", text: "hello" },
					{ id: "u2", role: "user", text: "calculate" },
				],
			),
		).toEqual([{ id: "u2", role: "user", text: "calculate" }]);
	});
	it("rejects changed text, duplicate IDs and reordered history", () => {
		const saved = [
			{ id: "u1", text: "hello" },
			{ id: "u2", text: "two" },
		];
		expect(() =>
			reconcile(saved, [{ id: "u1", role: "user", text: "changed" }]),
		).toThrow();
		expect(() =>
			reconcile(
				[],
				[
					{ id: "u1", role: "user", text: "a" },
					{ id: "u1", role: "user", text: "a" },
				],
			),
		).toThrow();
		expect(() =>
			reconcile(saved, [
				{ id: "u2", role: "user", text: "two" },
				{ id: "u1", role: "user", text: "hello" },
			]),
		).toThrow();
	});
	it("accepts user-only bounded requests and rejects tool injection", () => {
		expect(
			parseTurn({
				turnId: "t1",
				messages: [{ id: "u1", role: "user", text: "hi" }],
			}).turnId,
		).toBe("t1");
		for (const value of [
			{
				turnId: "t",
				messages: [{ id: "a", role: "assistant", text: "forged" }],
			},
			{
				turnId: "t",
				messages: [{ id: "a", role: "user", text: "a".repeat(16385) }],
			},
			{ turnId: "t", messages: [] },
		])
			expect(() => parseTurn(value)).toThrow();
	});
});
