import pino from "pino";
import { describe, expect, it } from "vitest";
import { createLogger } from "../logger.js";
import { createScriptedProvider } from "../provider/scripted.js";
import { createGraph } from "./graph.js";

const evidence = {
	sources: [
		{
			id: "s1",
			filename: "amber.md",
			ordinal: 0,
			text: "Amber valve recovery code is ORCHID-47.",
		},
	],
	context: "Amber valve recovery code is ORCHID-47.",
};
const logger = createLogger({ appName: "test" });
describe("managed graph", () => {
	it("retrieves evidence and returns a grounded answer", async () => {
		const graph = createGraph({
			provider: createScriptedProvider(),
			retrieve: async () => evidence,
			logger,
		});
		const id = await graph.create();
		expect(await graph.turn(id, "amber valve recovery code")).toMatchObject({
			answer: expect.stringContaining("ORCHID-47"),
			sources: evidence.sources,
		});
	});
	it("abstains for unrelated evidence", async () => {
		const graph = createGraph({
			provider: createScriptedProvider(),
			retrieve: async () => evidence,
			logger,
		});
		expect(
			(await graph.turn(await graph.create(), "purple penguin population"))
				.answer,
		).toContain("cannot answer");
	});
	it("bounds active sessions and expires ids", async () => {
		let now = 0;
		const graph = createGraph({
			provider: createScriptedProvider(),
			retrieve: async () => evidence,
			logger,
			maxSessions: 1,
			ttlMs: 10,
			now: () => now,
		});
		const id = await graph.create();
		await expect(graph.create()).rejects.toThrow("capacity");
		now = 11;
		await expect(graph.turn(id, "amber")).rejects.toThrow(
			"Unknown conversation",
		);
		expect(await graph.create()).not.toBe(id);
	});
	it("includes retrieval in the total deadline", async () => {
		const graph = createGraph({
			provider: createScriptedProvider(),
			retrieve: () => new Promise(() => {}),
			logger,
			deadlineMs: 20,
		});
		await expect(graph.turn(await graph.create(), "amber")).rejects.toThrow(
			"deadline",
		);
	});
});

it("rejects duplicate pending calls and more than four calls", async () => {
	for (const count of [2, 5]) {
		const provider = createScriptedProvider();
		provider.create = () => ({
			close: () => {},
			turn: async () => ({
				type: "pending",
				calls: Array.from({ length: count }, (_, index) => ({
					turnId: "t",
					callId: count === 2 ? "duplicate" : String(index),
					name: "retrieve_documents",
					arguments: { question: "amber" },
				})),
			}),
			output: async () => ({ type: "final", answer: "answer" }),
		});
		const graph = createGraph({
			provider,
			retrieve: async () => evidence,
			logger,
		});
		await expect(graph.turn(await graph.create(), "amber")).rejects.toThrow(
			"tool limit",
		);
	}
});
it("serializes each session while allowing isolated sessions to proceed", async () => {
	const provider = createScriptedProvider();
	let release: () => void = () => {};
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	const graph = createGraph({
		provider,
		retrieve: async (question) => {
			if (question === "blocked") await gate;
			return { sources: [], context: question };
		},
		logger,
	});
	const id = await graph.create();
	const other = await graph.create();
	let secondDone = false;
	const first = graph.turn(id, "blocked");
	const second = graph.turn(id, "second").then((value) => {
		secondDone = true;
		return value;
	});
	await graph.turn(other, "other");
	expect(secondDone).toBe(false);
	release();
	await Promise.all([first, second]);
	expect(secondDone).toBe(true);
});
it("queued turns share their deadline with queue time", async () => {
	const graph = createGraph({
		provider: createScriptedProvider(),
		retrieve: () => new Promise(() => {}),
		logger,
		deadlineMs: 20,
	});
	const id = await graph.create();
	const results = await Promise.allSettled([
		graph.turn(id, "first"),
		graph.turn(id, "second"),
	]);
	expect(results.every((result) => result.status === "rejected")).toBe(true);
});
it("never submits tool output after a deadline even if retrieval ignores cancellation", async () => {
	let release: (value: typeof evidence) => void = () => {};
	let outputs = 0;
	const retrieval = new Promise<typeof evidence>((resolve) => {
		release = resolve;
	});
	const provider = createScriptedProvider();
	const create = provider.create;
	provider.create = () => {
		const session = create();
		return {
			...session,
			output: async (...args) => {
				outputs++;
				return session.output(...args);
			},
		};
	};
	const graph = createGraph({
		provider,
		retrieve: () => retrieval,
		logger,
		deadlineMs: 10,
	});
	await expect(graph.turn(await graph.create(), "amber")).rejects.toThrow(
		"deadline",
	);
	release(evidence);
	await new Promise((resolve) => setTimeout(resolve, 10));
	expect(outputs).toBe(0);
});
it("rejects a provider final answer that skipped local retrieval", async () => {
	const provider = createScriptedProvider();
	provider.create = () => ({
		close: () => {},
		turn: async () => ({ type: "final", answer: "ungrounded answer" }),
		output: async () => ({ type: "final", answer: "unused" }),
	});
	const graph = createGraph({
		provider,
		retrieve: async () => evidence,
		logger,
	});
	await expect(graph.turn(await graph.create(), "amber")).rejects.toThrow(
		"skipped retrieval",
	);
});

it("includes the user query in successful and failed request operation logs", async () => {
	const lines: string[] = [];
	const captured = pino(
		{},
		{
			write: (line) => {
				lines.push(line);
			},
		},
	);
	const graph = createGraph({
		provider: createScriptedProvider(),
		retrieve: async () => evidence,
		logger: captured,
	});
	await graph.turn(await graph.create(), "amber valve");
	await expect(graph.turn("missing", "owner query")).rejects.toThrow(
		"Unknown conversation",
	);
	const entries = lines.map((line) => JSON.parse(line));
	expect(entries.map((entry) => entry.msg)).toEqual([
		"Agent turn...",
		"Agent turn succeeded.",
		"Agent turn...",
		"Agent turn failed.",
	]);
	expect(entries[1]).toMatchObject({
		query: "amber valve",
		sourceCount: 1,
		durationMs: expect.any(Number),
	});
	expect(entries[3]).toMatchObject({
		query: "owner query",
		err: { status: 404 },
		durationMs: expect.any(Number),
	});
	expect(lines.join("")).not.toContain("ORCHID-47");
});

it("reports safe deadline status without inferred cancellation metadata", async () => {
	const lines: string[] = [];
	const captured = pino(
		{},
		{
			write: (line) => {
				lines.push(line);
			},
		},
	);
	const graph = createGraph({
		provider: createScriptedProvider(),
		retrieve: () => new Promise(() => {}),
		logger: captured,
		deadlineMs: 10,
	});
	await expect(graph.turn(await graph.create(), "amber")).rejects.toThrow(
		"deadline",
	);
	const failure = lines
		.map((line) => JSON.parse(line))
		.find((entry) => entry.msg === "Agent turn failed.");
	expect(failure).toMatchObject({ err: { status: 504 } });
	expect(failure).not.toHaveProperty("cancelled");
});
