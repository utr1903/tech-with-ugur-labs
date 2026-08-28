import { describe, expect, it } from "bun:test";
import { expectConsistentDenial, retryUntilSuccess } from "./retry";

const noSleep = async (_ms: number) => {};

describe("retryUntilSuccess", () => {
	it("returns the first successful result", async () => {
		let calls = 0;
		const result = await retryUntilSuccess(
			async () => {
				calls += 1;
				if (calls < 3) throw new Error("not yet");
				return "ok";
			},
			{ sleep: noSleep },
		);
		expect(result).toBe("ok");
		expect(calls).toBe(3);
	});

	it("rethrows the last error when attempts are exhausted", async () => {
		let calls = 0;
		await expect(
			retryUntilSuccess(
				async () => {
					calls += 1;
					throw new Error(`fail ${calls}`);
				},
				{ attempts: 4, sleep: noSleep },
			),
		).rejects.toThrow("fail 4");
		expect(calls).toBe(4);
	});
});

describe("expectConsistentDenial", () => {
	const denial = Object.assign(new Error("denied"), { code: 403 });
	const isDenial = (err: unknown) => (err as { code?: number }).code === 403;

	it("passes when every attempt is denied", async () => {
		const outcome = await expectConsistentDenial(
			async () => {
				throw denial;
			},
			{ isExpectedDenial: isDenial, sleep: noSleep },
		);
		expect(outcome.deniedConsistently).toBe(true);
	});

	it("fails when any attempt unexpectedly succeeds", async () => {
		let calls = 0;
		const outcome = await expectConsistentDenial(
			async () => {
				calls += 1;
				if (calls === 2) return;
				throw denial;
			},
			{ isExpectedDenial: isDenial, sleep: noSleep },
		);
		expect(outcome.deniedConsistently).toBe(false);
		expect(outcome.detail).toContain("succeeded");
	});

	it("fails when an attempt throws a non-denial error", async () => {
		const outcome = await expectConsistentDenial(
			async () => {
				throw new Error("network unreachable");
			},
			{ isExpectedDenial: isDenial, sleep: noSleep },
		);
		expect(outcome.deniedConsistently).toBe(false);
		expect(outcome.detail).toContain("network unreachable");
	});
});
