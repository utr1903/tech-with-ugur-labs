import pino from "pino";
import { expect, it } from "vitest";
import { createScriptedProvider } from "../provider/scripted.js";
import { createGraph } from "./graph.js";

function setup() {
	const records: { query: string; status: string; answer?: string }[] = [];
	const lines: string[] = [];
	const logger = pino(
		{},
		{
			write: (line) => {
				lines.push(line);
			},
		},
	);
	const chats = {
		begin: async (_id: string, query: string) => {
			records.push({ query, status: "pending" });
			return records.length - 1;
		},
		history: async () => [],
		complete: async (id: number, result: { answer: string }) => {
			Object.assign(records[id] ?? {}, result, { status: "completed" });
		},
		fail: async (id: number, status: string) => {
			Object.assign(records[id] ?? {}, { status });
		},
	};
	return { records, lines, chats, logger };
}
it("includes queue time in the deadline and aborts held retrieval without saving partial output", async () => {
	const state = setup();
	let signal: AbortSignal | undefined;
	const graph = createGraph({
		...state,
		provider: createScriptedProvider(),
		deadlineMs: 15,
		retrieve: async (_query, passed) => {
			signal = passed;
			return new Promise(() => {});
		},
	});
	const abort = new AbortController();
	const results = await Promise.allSettled([
		graph.turn("chat", "amber valve", () => {}, abort.signal),
		graph.turn("chat", "queued", () => {}, abort.signal),
	]);
	expect(results.every((r) => r.status === "rejected")).toBe(true);
	expect(signal?.aborted).toBe(true);
	await new Promise((r) => setTimeout(r, 10));
	expect(state.records.every((r) => r.status === "cancelled")).toBe(true);
	expect(state.records.every((r) => !r.answer)).toBe(true);
	const logs = state.lines.map((l) => JSON.parse(l));
	expect(logs.find((l) => l.msg === "Agent turn failed.")).toMatchObject({
		query: "amber valve",
		sessionId: "chat",
		err: { status: 504 },
		durationMs: expect.any(Number),
	});
});
it("withholds raw upstream errors while retaining the query in operation logs", async () => {
	const state = setup();
	const provider = createScriptedProvider();
	provider.run = async () => {
		throw Error("YOUR_OPENAI_API_KEY upstream details");
	};
	const graph = createGraph({
		...state,
		provider,
		retrieve: async () => ({ sources: [], context: "" }),
	});
	await expect(
		graph.turn(
			"chat",
			"owner question",
			() => {},
			new AbortController().signal,
		),
	).rejects.toThrow();
	expect(state.records[0]?.status).toBe("failed");
	expect(state.lines.join("")).not.toContain("YOUR_OPENAI_API_KEY");
	expect(state.lines.join("")).toContain("owner question");
});
