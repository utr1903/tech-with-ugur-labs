import { afterEach, expect, test, vi } from "vitest";
import { createController } from "../../../../frontend/src/voice/controller.js";
import {
	fetchAnswer,
	fetchToken,
} from "../../../../frontend/src/voice/http.js";
import type {
	Call,
	State,
	Token,
	Transport,
} from "../../../../frontend/src/voice/transport.js";
import { createLogger } from "../logger.js";
import { createScriptedProvider } from "../provider/scripted.js";
import { createApp } from "./app.js";

afterEach(() => vi.unstubAllGlobals());
test("terminal graph failure ends browser session; fresh Start recovers with a distinct ID", async () => {
	const logger = createLogger({ appName: "controller-integration" });
	logger.level = "silent";
	const provider = createScriptedProvider();
	const create = provider.create;
	let fail = true;
	let closed = 0;
	provider.create = () => {
		const session = create();
		return {
			...session,
			close: () => {
				closed++;
				session.close();
			},
			turn: async (question, signal) => {
				if (fail) {
					fail = false;
					throw Error("private provider detail");
				}
				return session.turn(question, signal);
			},
		};
	};
	const app = createApp({
		provider,
		logger,
		corpus: {
			ingest: async () => ({ added: 0, changed: 0, deleted: 0, unchanged: 1 }),
			retrieve: async () => ({
				context: "amber valve ORCHID-47",
				sources: [
					{
						id: "chunk",
						filename: "handbook.md",
						ordinal: 0,
						text: "amber valve ORCHID-47",
					},
				],
			}),
		},
	});
	const signals: AbortSignal[] = [];
	vi.stubGlobal("fetch", (path: string, init: RequestInit) => {
		if (init.signal) signals.push(init.signal);
		return app.request(path, init);
	});
	const states: State[] = [];
	const tokens: Token[] = [];
	const callbacks: ((call: Call) => void)[] = [];
	const disposed: number[] = [];
	const outputs: unknown[] = [];
	const controller = createController({
		token: fetchToken,
		relay: fetchAnswer,
		change: (state) => states.push(state),
		transport: (): Transport => {
			const index = tokens.length;
			return {
				start: async (token, callback) => {
					tokens.push(token);
					callbacks.push(callback);
				},
				question: () => {},
				output: (id, result) => outputs.push({ id, result }),
				dispose: () => disposed.push(index),
			};
		},
	});
	try {
		await controller.start();
		callbacks[0]?.({ id: "failed", question: "amber valve" });
		await vi.waitFor(() => expect(states.at(-1)?.error).toBeTruthy());
		const stale = await app.request("/api/agent", {
			method: "POST",
			body: JSON.stringify({
				conversationId: tokens[0]?.conversationId,
				question: "amber valve",
			}),
		});
		expect(stale.status).toBe(404);
		expect(closed).toBe(1);
		expect(states.at(-1)).toMatchObject({
			status: "Error",
			error: expect.stringContaining("Start again"),
		});
		expect(disposed).toEqual([0]);
		expect(signals.every((signal) => signal.aborted)).toBe(true);
		expect(JSON.stringify(states)).not.toContain("private provider detail");
		const before = states.length;
		callbacks[0]?.({ id: "stale", question: "amber valve" });
		expect(states).toHaveLength(before);
		await controller.start();
		expect(tokens[1]?.conversationId).not.toBe(tokens[0]?.conversationId);
		callbacks[1]?.({ id: "fresh", question: "amber valve" });
		await vi.waitFor(() =>
			expect(states.at(-1)?.answer?.answer).toContain("ORCHID-47"),
		);
		expect(outputs).toEqual([
			{
				id: "fresh",
				result: expect.objectContaining({
					answer: expect.stringContaining("ORCHID-47"),
				}),
			},
		]);
	} finally {
		controller.stop();
	}
	expect(disposed).toEqual([0, 1]);
});
