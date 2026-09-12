import { expect, it } from "vitest";
import { createLogger } from "../logger.js";
import { createScriptedProvider } from "../provider/scripted.js";
import { createGraph } from "./graph.js";

const evidence = {
	sources: [
		{ id: "s1", filename: "amber.md", ordinal: 0, text: "amber ORCHID-47" },
	],
	context: "amber ORCHID-47",
};
const logger = createLogger({ appName: "lifecycle-test" });
logger.level = "silent";
it("does not start queued work after the first turn fails", async () => {
	let fail: (err: Error) => void = () => {};
	const failure = new Promise<never>((_resolve, reject) => {
		fail = reject;
	});
	let turns = 0;
	const provider = createScriptedProvider();
	const create = provider.create;
	provider.create = () => {
		const session = create();
		return {
			...session,
			turn: async (...args) => {
				turns++;
				if (turns === 1) return failure;
				return session.turn(...args);
			},
		};
	};
	const graph = createGraph({
		provider,
		retrieve: async () => evidence,
		logger,
	});
	const id = await graph.create();
	const outcomes = Promise.allSettled([
		graph.turn(id, "first"),
		graph.turn(id, "second"),
	]);
	await Promise.resolve();
	fail(Error("first provider failed"));
	const results = await outcomes;
	expect(results.map((result) => result.status)).toEqual([
		"rejected",
		"rejected",
	]);
	expect(turns).toBe(1);
});
it.each(["remove", "expiry"] as const)(
	"invalidates active and queued work on %s",
	async (action) => {
		let now = 0;
		let release: () => void = () => {};
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		let turns = 0;
		let outputs = 0;
		const provider = createScriptedProvider();
		const create = provider.create;
		provider.create = () => {
			const session = create();
			return {
				...session,
				turn: async (...args) => {
					turns++;
					await gate;
					return session.turn(...args);
				},
				output: async (...args) => {
					outputs++;
					return session.output(...args);
				},
			};
		};
		const graph = createGraph({
			provider,
			retrieve: async () => evidence,
			logger,
			ttlMs: 10,
			now: () => now,
			deadlineMs: 1000,
		});
		const id = await graph.create();
		const outcomes = Promise.allSettled([
			graph.turn(id, "first"),
			graph.turn(id, "second"),
		]);
		await Promise.resolve();
		if (action === "remove") graph.remove(id);
		else {
			now = 11;
			await graph.create();
		}
		const cancellation = await Promise.race([
			outcomes,
			new Promise<"pending">((resolve) =>
				setTimeout(() => resolve("pending"), 100),
			),
		]);
		release();
		expect(cancellation).not.toBe("pending");
		const results = await outcomes;
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(results.map((result) => result.status)).toEqual([
			"rejected",
			"rejected",
		]);
		expect(turns).toBe(1);
		expect(outputs).toBe(0);
	},
);
