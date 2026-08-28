import { describe, expect, it } from "bun:test";
import { type ProofResult, summarize } from "./result";

function result(passed: boolean): ProofResult {
	return { proof: "p", expectation: "e", passed, detail: "d" };
}

describe("summarize", () => {
	it("returns exit code 0 when every proof passed", () => {
		expect(summarize([result(true), result(true)])).toEqual({
			passedCount: 2,
			failedCount: 0,
			exitCode: 0,
		});
	});

	it("returns exit code 1 when any proof failed", () => {
		expect(summarize([result(true), result(false)])).toEqual({
			passedCount: 1,
			failedCount: 1,
			exitCode: 1,
		});
	});

	it("returns exit code 1 for an empty result set (nothing proven)", () => {
		expect(summarize([]).exitCode).toBe(1);
	});
});
