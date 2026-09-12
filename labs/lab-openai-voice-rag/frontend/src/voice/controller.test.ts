import { expect, test, vi } from "vitest";
import { createController } from "./controller";
import type { AgentEvent, Call, State, Transport } from "./transport";

function setup() {
	const states: State[] = [];
	let call!: (c: Call) => void;
	let interrupt!: () => void;
	let emit!: (e: AgentEvent) => void;
	let reject!: (err: Error) => void;
	let fail!: () => void;
	let finish!: (a: { answer: string; sources: [] }) => void;
	const requests: { id: string; query: string; signal: AbortSignal }[] = [];
	const t = {
		start: async (
			_: unknown,
			c: (c: Call) => void,
			_f: () => void,
			i: () => void,
		) => {
			call = c;
			fail = _f;
			interrupt = i;
		},
		say: vi.fn(),
		clearSpeech: vi.fn(),
		question: vi.fn(),
		dispose: vi.fn(),
	} satisfies Transport;
	let id = 0;
	const c = createController({
		sessionId: () => `chat-${++id}`,
		token: async () => ({ mode: "scripted" }),
		transport: () => t,
		change: (s) => states.push(s),
		relay: (id, query, signal, onEvent) => {
			requests.push({ id, query, signal });
			emit = onEvent;
			return new Promise((resolve, rejectPromise) => {
				reject = rejectPromise;
				finish = resolve;
			});
		},
	});
	return {
		c,
		t,
		states,
		requests,
		call: (x: Call) => call(x),
		interrupt: () => interrupt(),
		emit: (e: AgentEvent) => emit(e),
		fail: () => fail(),
		reject: () => reject(Error("private provider detail")),
		finish: () => finish({ answer: "First.", sources: [] }),
	};
}
test("UUID stays across turns and changes every Start; partial UI and speech precede done", async () => {
	const s = setup();
	await s.c.start();
	s.call({ id: "a", question: "amber valve?" });
	s.emit({ type: "delta", text: "First." });
	expect(s.states.at(-1)).toMatchObject({
		query: "amber valve?",
		answer: { answer: "First." },
	});
	expect(s.t.say).toHaveBeenCalledWith("First.");
	s.finish();
	await Promise.resolve();
	s.call({ id: "b", question: "next?" });
	expect(s.requests.map((r) => r.id)).toEqual(["chat-1", "chat-1"]);
	await s.c.start();
	s.call({ id: "c", question: "fresh?" });
	expect(s.requests.at(-1)?.id).toBe("chat-2");
	s.c.stop();
});
test("interrupt aborts only current turn and suppresses late deltas", async () => {
	const s = setup();
	await s.c.start();
	s.call({ id: "a", question: "old" });
	s.interrupt();
	expect(s.requests[0]?.signal.aborted).toBe(true);
	s.emit({ type: "delta", text: "Late." });
	expect(s.t.say).not.toHaveBeenCalled();
	s.call({ id: "b", question: "new" });
	expect(s.requests.at(-1)?.id).toBe("chat-1");
	s.c.stop();
});

test("request error allows next question in same chat, never retries", async () => {
	const s = setup();
	await s.c.start();
	s.call({ id: "a", question: "first" });
	s.reject();
	await Promise.resolve();
	expect(s.states.at(-1)).toMatchObject({
		status: "Ready",
		mode: "scripted",
		error: "Knowledge request failed. Ask another question to continue.",
	});
	expect(s.requests).toHaveLength(1);
	expect(s.t.dispose).not.toHaveBeenCalled();
	s.call({ id: "b", question: "next" });
	expect(s.requests.at(-1)?.id).toBe("chat-1");
	s.c.stop();
});
test("duplicate transcripts do not interrupt or repeat a request", async () => {
	const s = setup();
	await s.c.start();
	s.call({ id: "a", question: "q" });
	s.call({ id: "a", question: "duplicate" });
	expect(s.requests).toHaveLength(1);
	expect(s.requests[0]?.signal.aborted).toBe(false);
	s.c.stop();
});
test("connection failure disposes and makes later calls inert", async () => {
	const s = setup();
	await s.c.start();
	s.call({ id: "a", question: "q" });
	s.fail();
	expect(s.states.at(-1)?.status).toBe("Error");
	expect(s.t.dispose).toHaveBeenCalledOnce();
	expect(s.requests[0]?.signal.aborted).toBe(true);
	s.emit({ type: "delta", text: "late." });
	s.call({ id: "b", question: "q" });
	expect(s.requests).toHaveLength(1);
	expect(s.t.say).not.toHaveBeenCalled();
});
test("Stop ignores token arriving late without allocating transport", async () => {
	let resolve!: (token: { mode: "scripted" }) => void;
	const factory = vi.fn();
	const states: State[] = [];
	const c = createController({
		sessionId: () => "uuid",
		token: () =>
			new Promise((r) => {
				resolve = r;
			}),
		transport: factory,
		relay: vi.fn(),
		change: (s) => states.push(s),
	});
	const pending = c.start();
	c.stop();
	resolve({ mode: "scripted" });
	await pending;
	expect(factory).not.toHaveBeenCalled();
	expect(states.at(-1)?.status).toBe("Stopped");
});

test("late connection success does not overwrite a turn already searching", async () => {
	const states: State[] = [];
	const t: Transport = {
		start: async (_token, call) => {
			call({ id: "early", question: "q" });
		},
		say() {},
		clearSpeech() {},
		question() {},
		dispose() {},
	};
	const c = createController({
		sessionId: () => "uuid",
		token: async () => ({ mode: "live" }),
		transport: () => t,
		relay: () => new Promise(() => {}),
		change: (s) => states.push(s),
	});
	await c.start();
	expect(states.at(-1)?.status).toBe("Searching");
	c.stop();
});
